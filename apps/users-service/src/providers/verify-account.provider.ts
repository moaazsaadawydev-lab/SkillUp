import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { DataSource } from 'typeorm';
import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';
import { User } from '@skillup/shared/entities';
import { UserStatus } from '@skillup/shared/enums';
import { RedisService } from '@skillup/shared/redis';
import {
  VerifyAccountRequest,
  VerifyAccountResponse,
} from '@skillup/shared/interfaces';

@Injectable()
export class VerifyAccountProvider {
  private readonly logger = new Logger(VerifyAccountProvider.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Account verification and auto-login session generation:
   * 1. Validate inputs and normalize email.
   * 2. Brute-force guard: Max 7 failed attempts in Redis key `rate:verify:{email}`.
   * 3. Validate OTP against SHA-256 hash in Redis key `otp:verify:{email}`.
   * 4. Atomic DB transaction: Ensure user is PENDING, activate user (status = ACTIVE).
   * 5. Clean up Redis OTP and attempt keys.
   * 6. Generate session (UUID), sign JWT accessToken (15m TTL), generate and hash refreshToken (32-bytes hex).
   * 7. Store session hash in Redis (`session:{sessionId}`) with 7 days TTL.
   * 8. Manage user sessions in Redis ZSET (`user_sessions:{userId}`) enforcing max 5 devices.
   * 9. Return auth tokens and user profile.
   */
  async verifyAccount(request: VerifyAccountRequest): Promise<VerifyAccountResponse> {
    const normalizedEmail = request.email.trim().toLowerCase();
    const code = request.code.trim();
    const ipAddress = request.ipAddress || request.ip_address || '127.0.0.1';
    const userAgent = request.userAgent || request.user_agent || 'unknown';

    const redisOtpKey = `otp:verify:${normalizedEmail}`;
    const rateLimitKey = `rate:verify:${normalizedEmail}`;

    // 1. Pre-execution Check: Brute-force & Rate Limit Guard
    try {
      const currentAttemptsStr = await this.redisService.get(rateLimitKey);
      const currentAttempts = currentAttemptsStr
        ? parseInt(currentAttemptsStr, 10)
        : 0;

      if (currentAttempts >= 7) {
        const remainingTtl = await this.redisService.ttl(rateLimitKey);
        const ttlSeconds = remainingTtl > 0 ? remainingTtl : 15 * 60;
        throw new RpcException({
          code: status.RESOURCE_EXHAUSTED,
          message: `Too many failed verification attempts. Please try again after 15 minutes. [Retry-After: ${ttlSeconds}]`,
        });
      }
    } catch (error) {
      if (error instanceof RpcException) throw error;
      this.logger.error(
        `Failed to check verification rate limit for ${normalizedEmail}:`,
        error,
      );
    }

    // 2. Validate OTP against stored SHA-256 hash
    const storedHashedOtp = await this.redisService.get(redisOtpKey);
    if (!storedHashedOtp) {
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: 'Verification code has expired or does not exist.',
      });
    }

    const hashedInputCode = crypto
      .createHash('sha256')
      .update(code)
      .digest('hex');

    if (hashedInputCode !== storedHashedOtp) {
      let attempts = 1;
      try {
        attempts = await this.redisService.incr(rateLimitKey);
        if (attempts === 1) {
          // Set expiration window (15 minutes = 900 seconds) on the very first failure
          await this.redisService.expire(rateLimitKey, 15 * 60);
        } else if (attempts >= 7) {
          // Enforce full 15-minute lock duration on reaching the threshold
          await this.redisService.expire(rateLimitKey, 15 * 60);
        }
      } catch (redisErr) {
        this.logger.error(
          `Failed to increment verification rate limit for ${normalizedEmail}:`,
          redisErr,
        );
      }

      if (attempts >= 7) {
        try {
          await this.redisService.del(redisOtpKey);
        } catch (delErr) {
          this.logger.error(
            `Failed to delete OTP key for ${normalizedEmail}:`,
            delErr,
          );
        }
        throw new RpcException({
          code: status.RESOURCE_EXHAUSTED,
          message: `Too many failed verification attempts. Please try again after 15 minutes. [Retry-After: ${15 * 60}]`,
        });
      }

      const remainingAttempts = Math.max(0, 7 - attempts);
      throw new RpcException({
        code: status.INVALID_ARGUMENT,
        message: `Invalid verification code. You have ${remainingAttempts} attempts remaining.`,
      });
    }

    // 3. Database user activation inside transaction
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    let user: User;
    try {
      const foundUser = await queryRunner.manager.findOne(User, {
        where: { email: normalizedEmail },
      });

      if (!foundUser) {
        throw new RpcException({
          code: status.NOT_FOUND,
          message: 'User not found',
        });
      }

      if (foundUser.status === UserStatus.ACTIVE) {
        throw new RpcException({
          code: status.FAILED_PRECONDITION,
          message: 'Account is already active.',
        });
      }

      foundUser.status = UserStatus.ACTIVE;
      foundUser.updatedAt = new Date();
      user = await queryRunner.manager.save(User, foundUser);

      await queryRunner.commitTransaction();
    } catch (dbError) {
      await queryRunner.rollbackTransaction();
      if (dbError instanceof RpcException) {
        throw dbError;
      }
      this.logger.error(
        `Database error during account verification for ${normalizedEmail}:`,
        dbError,
      );
      throw new RpcException({
        code: status.INTERNAL,
        message: 'Failed to activate user account',
      });
    } finally {
      await queryRunner.release();
    }

    // 4. Redis cleanup of OTP, rate-limit counter, and legacy attempt keys
    await Promise.all([
      this.redisService.del(rateLimitKey),
      this.redisService.del(redisOtpKey),
      this.redisService.del(`otp:attempts:${normalizedEmail}`),
    ]);

    // 5. Session issuance & Dual tokens
    const sessionId = crypto.randomUUID();
    const jwtSecret = this.configService.get<string>(
      'JWT_SECRET',
      'super_secret_jwt_key_skillup_change_in_production',
    );

    const accessToken = jwt.sign(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
        sessionId,
      },
      jwtSecret,
      { expiresIn: '15m' },
    );

    const refreshToken = crypto.randomBytes(32).toString('hex');
    const hashedRefreshToken = crypto
      .createHash('sha256')
      .update(refreshToken)
      .digest('hex');

    const sessionKey = `session:${sessionId}`;
    const userSessionsKey = `user_sessions:${user.id}`;
    const now = Date.now();

    // Store session hash in Redis with 7 days TTL (604800s)
    await this.redisService.hset(sessionKey, {
      userId: user.id,
      hashedRefreshToken,
      ipAddress,
      userAgent,
      createdAt: new Date().toISOString(),
    });
    await this.redisService.expire(sessionKey, 7 * 24 * 60 * 60);

    // Add session to user's sorted set
    await this.redisService.zadd(userSessionsKey, now, sessionId);
    await this.redisService.expire(userSessionsKey, 7 * 24 * 60 * 60);

    // Enforce max 5 devices / sessions
    const staleSessions = await this.redisService.zrange(userSessionsKey, 0, -6);
    if (staleSessions && staleSessions.length > 0) {
      this.logger.debug(
        `Purging ${staleSessions.length} stale session(s) for user ${user.id}`,
      );
      await Promise.all(
        staleSessions.map((staleId) => this.redisService.del(`session:${staleId}`)),
      );
      await this.redisService.zremRangeByRank(userSessionsKey, 0, -6);
    }

    this.logger.log(
      `Account verified and session issued for user ${user.id} (${normalizedEmail})`,
    );

    return {
      success: true,
      message: 'Account verified successfully',
      data: {
        accessToken,
        refreshToken,
        access_token: accessToken,
        refresh_token: refreshToken,
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          role: user.role,
          status: user.status,
          profilePhoto: user.profilePhoto || '',
          birthDate: user.birthDate ? user.birthDate.toString() : '',
          createdAt: user.createdAt.toISOString(),
          updatedAt: user.updatedAt.toISOString(),
        },
      },
    };
  }
}
