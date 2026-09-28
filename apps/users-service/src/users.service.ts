import {
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';
import { User, OutboxMessage } from '@skillup/shared/entities';
import { UserRole, UserStatus, OutboxStatus } from '@skillup/shared/enums';
import { OUTBOX_EVENTS } from '@skillup/shared/constants';
import { RedisService } from '@skillup/shared/redis';
import {
  CreateUserRequest,
  CreateUserResponse,
  VerifyAccountRequest,
  VerifyAccountResponse,
  SendVerificationCodeRequest,
  ActionResponse,
} from '@skillup/shared/interfaces';
import { OutboxWorker } from './outbox/outbox.worker';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly redisService: RedisService,
    private readonly outboxWorker: OutboxWorker,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Atomic user registration handling:
   * 1. Duplicate checks for username and email.
   * 2. Bcrypt password hashing.
   * 3. Database user creation in PENDING status.
   * 4. Secure 6-digit OTP generation and SHA-256 hashed caching in Redis.
   * 5. Outbox event creation for email verification and photo processing.
   * 6. Dual-write rollback mitigation.
   */
  async createUser(request: CreateUserRequest): Promise<CreateUserResponse> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    const normalizedEmail = request.email.trim().toLowerCase();
    const normalizedUsername = request.username.trim();
    const birthDate = request.birthDate || request.birth_date || null;
    const profilePhoto = request.profilePhoto || request.profile_photo || null;
    const tempPhotoKey = request.tempPhotoKey || request.temp_photo_key || null;

    let otpStoredInRedis = false;
    const redisOtpKey = `otp:verify:${normalizedEmail}`;

    try {
      // 1. Duplicate check (Email & Username)
      const existingUser = await queryRunner.manager.findOne(User, {
        where: [{ email: normalizedEmail }, { username: normalizedUsername }],
      });

      if (existingUser) {
        const duplicateField =
          existingUser.email.toLowerCase() === normalizedEmail
            ? 'email'
            : 'username';

        throw new RpcException({
          code: status.ALREADY_EXISTS,
          message: `User with this ${duplicateField} already exists`,
        });
      }

      // 2. Hash Password
      const saltRounds = 10;
      const hashedPassword = await bcrypt.hash(request.password, saltRounds);

      // 3. Create User entity
      const userId = request.id || crypto.randomUUID();
      const user = queryRunner.manager.create(User, {
        id: userId,
        username: normalizedUsername,
        email: normalizedEmail,
        password: hashedPassword,
        role: UserRole.STUDENT,
        status: UserStatus.PENDING,
        profilePhoto,
        birthDate,
      });

      await queryRunner.manager.save(User, user);

      // 4. Generate 6-digit cryptographically secure OTP & Hash with SHA-256
      const plainOtpCode = crypto.randomInt(100000, 1000000).toString();
      const hashedOtp = crypto
        .createHash('sha256')
        .update(plainOtpCode)
        .digest('hex');

      // Store hashed OTP in Redis with 10 minutes TTL (600s)
      await this.redisService.setWithTtl(redisOtpKey, hashedOtp, 600);
      // Cooldown for 60 seconds after registration
      await this.redisService.setWithTtl(`cooldown:verify:${normalizedEmail}`, '1', 60);
      otpStoredInRedis = true;

      // 5. Create Transactional Outbox Events
      // Event 1: SEND_VERIFICATION_EMAIL
      const emailOutboxMessage = queryRunner.manager.create(OutboxMessage, {
        eventType: OUTBOX_EVENTS.SEND_VERIFICATION_EMAIL,
        payload: {
          email: normalizedEmail,
          code: plainOtpCode,
          username: normalizedUsername,
        },
        status: OutboxStatus.PENDING,
        retryCount: 0,
      });
      await queryRunner.manager.save(OutboxMessage, emailOutboxMessage);

      // Event 2: PROCESS_PROFILE_PHOTO (if photo uploaded)
      if (tempPhotoKey && profilePhoto) {
        const photoOutboxMessage = queryRunner.manager.create(OutboxMessage, {
          eventType: OUTBOX_EVENTS.PROCESS_PROFILE_PHOTO,
          payload: {
            userId: user.id,
            tempKey: tempPhotoKey,
            targetKey: profilePhoto,
            transformations: request.transformations || null,
          },
          status: OutboxStatus.PENDING,
          retryCount: 0,
        });
        await queryRunner.manager.save(OutboxMessage, photoOutboxMessage);
      }

      // 6. Commit Database Transaction
      await queryRunner.commitTransaction();

      this.logger.log(
        `User ${user.id} (${normalizedEmail}) created successfully with PENDING status.`,
      );

      // 7. Fire asynchronous outbox worker post-commit
      this.outboxWorker.trigger();

      return {
        success: true,
        message: 'Verification code sent to your email',
        userId: user.id,
      };
    } catch (error) {
      // Dual-write mitigation: rollback database and delete key from Redis if write occurred
      await queryRunner.rollbackTransaction();

      if (otpStoredInRedis) {
        try {
          await this.redisService.del(redisOtpKey);
          this.logger.debug(
            `Rolled back Redis OTP key "${redisOtpKey}" due to database transaction failure.`,
          );
        } catch (redisError) {
          this.logger.error(
            `Failed to cleanup Redis OTP key "${redisOtpKey}":`,
            redisError,
          );
        }
      }

      if (error instanceof RpcException) {
        throw error;
      }

      this.logger.error(
        `Failed to create user "${normalizedEmail}":`,
        error instanceof Error ? error.stack : error,
      );

      throw new RpcException({
        code: status.INTERNAL,
        message:
          error instanceof Error
            ? error.message
            : 'Internal server error during user registration',
      });
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Account verification and auto-login session generation:
   * 1. Validate inputs and normalize email.
   * 2. Brute-force guard: Max 5 failed attempts in Redis key `otp:attempts:{email}`.
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

  /**
   * Resend verification code:
   * 1. Validates 60-second cooldown via Redis.
   * 2. Finds user by email; ensures user exists and status is PENDING.
   * 3. Generates fresh cryptographically secure 6-digit OTP & hashes it (SHA-256).
   * 4. Overwrites/stores OTP in Redis with 10-minute TTL.
   * 5. Clears previous failed attempts / rate-limit counter in Redis.
   * 6. Sets 60-second cooldown in Redis.
   * 7. Saves SEND_VERIFICATION_EMAIL message to Outbox within a transaction.
   * 8. Triggers OutboxWorker.
   */
  async sendVerificationCode(
    request: SendVerificationCodeRequest,
  ): Promise<ActionResponse> {
    const normalizedEmail = request.email.trim().toLowerCase();
    const cooldownKey = `cooldown:verify:${normalizedEmail}`;
    const redisOtpKey = `otp:verify:${normalizedEmail}`;
    const rateLimitKey = `rate:verify:${normalizedEmail}`;
    const legacyAttemptsKey = `otp:attempts:${normalizedEmail}`;

    // 1. Lockout Guard: Check if verification is frozen for 15 minutes due to 7 failed attempts
    const currentAttemptsStr = await this.redisService.get(rateLimitKey);
    const currentAttempts = currentAttemptsStr
      ? parseInt(currentAttemptsStr, 10)
      : 0;

    if (currentAttempts >= 7) {
      const lockTtl = await this.redisService.ttl(rateLimitKey);
      const remainingSeconds = lockTtl > 0 ? lockTtl : 15 * 60;
      throw new RpcException({
        code: status.RESOURCE_EXHAUSTED,
        message: `Account verification is temporarily locked due to 7 failed attempts. Please wait ${remainingSeconds} seconds before requesting a new code. [Retry-After: ${remainingSeconds}]`,
      });
    }

    // 2. Cooldown check (60 seconds between resends)
    const cooldownTtl = await this.redisService.ttl(cooldownKey);
    if (cooldownTtl > 0) {
      throw new RpcException({
        code: status.RESOURCE_EXHAUSTED,
        message: `Please wait ${cooldownTtl} seconds before requesting a new verification code. [Retry-After: ${cooldownTtl}]`,
      });
    }

    // 2. User lookup
    const user = await this.dataSource.getRepository(User).findOne({
      where: { email: normalizedEmail },
    });

    if (!user) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'No account found with this email address.',
      });
    }

    if (user.status === UserStatus.ACTIVE) {
      throw new RpcException({
        code: status.FAILED_PRECONDITION,
        message: 'Account is already active. Please proceed to login.',
      });
    }

    if (user.status === UserStatus.BLOCKED) {
      throw new RpcException({
        code: status.PERMISSION_DENIED,
        message: 'Account is not eligible for verification.',
      });
    }

    // 3. Generate fresh 6-digit OTP & Hash with SHA-256
    const plainOtpCode = crypto.randomInt(100000, 1000000).toString();
    const hashedOtp = crypto
      .createHash('sha256')
      .update(plainOtpCode)
      .digest('hex');

    // 4. Update Redis: overwrite OTP (10 mins), set cooldown (60s), reset failed attempts
    await Promise.all([
      this.redisService.setWithTtl(redisOtpKey, hashedOtp, 600),
      this.redisService.setWithTtl(cooldownKey, '1', 60),
      this.redisService.del(rateLimitKey),
      this.redisService.del(legacyAttemptsKey),
    ]);

    // 5. Transactional Outbox for sending email
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const emailOutbox = queryRunner.manager.create(OutboxMessage, {
        eventType: OUTBOX_EVENTS.SEND_VERIFICATION_EMAIL,
        payload: {
          email: user.email,
          code: plainOtpCode,
          username: user.username,
        },
        status: OutboxStatus.PENDING,
        retryCount: 0,
      });

      await queryRunner.manager.save(OutboxMessage, emailOutbox);
      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(
        `Failed to create outbox event for resending verification code to ${normalizedEmail}:`,
        error,
      );
      throw new RpcException({
        code: status.INTERNAL,
        message: 'Failed to queue verification email. Please try again.',
      });
    } finally {
      await queryRunner.release();
    }

    // 6. Trigger outbox worker
    this.outboxWorker.trigger();

    this.logger.log(
      `New verification code generated and queued for ${normalizedEmail}`,
    );

    return {
      success: true,
      message: 'A new verification code has been sent to your email address.',
    };
  }
}

