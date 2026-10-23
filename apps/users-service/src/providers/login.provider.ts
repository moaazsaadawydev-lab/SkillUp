import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';
import { User } from '@skillup/shared/entities';
import { UserStatus } from '@skillup/shared/enums';
import { RedisService } from '@skillup/shared/redis';
import { LoginRequest, LoginResponse } from '@skillup/shared/interfaces';

@Injectable()
export class LoginProvider {
  private readonly logger = new Logger(LoginProvider.name);

  // Precomputed dummy bcrypt hash to equalize response times against timing attacks
  private static readonly DUMMY_BCRYPT_HASH =
    '$2b$10$wK1e9rM8h6iVbEaZ5gQ6weQ4bQ9xZ2z0dK7uT3eN1uO8wK1e9rM8h';

  constructor(
    private readonly dataSource: DataSource,
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Enterprise-Grade Authentication Flow:
   * 1. Dual-identifier normalization (email or username).
   * 2. Redis-based brute-force pre-check (5 attempts / 15-minute freeze).
   * 3. Database query for user by email or username.
   * 4. Precomputed dummy bcrypt comparison on non-existent users (Timing attack defense).
   * 5. User status validation (Reject PENDING or BLOCKED).
   * 6. Bcrypt password verification with incremental failure tracking.
   * 7. Clear failed attempts, issue dual-tokens (JWT + bcrypt-hashed refresh token),
   *    and enforce atomic 5-device session limit via Redis Lua script.
   */
  async login(request: LoginRequest): Promise<LoginResponse> {
    const rawIdentifier = (request.identifier || '').trim();
    const isEmail = rawIdentifier.includes('@');
    const normalizedIdentifier = isEmail
      ? rawIdentifier.toLowerCase()
      : rawIdentifier;
    const password = request.password || '';
    const ipAddress = request.ipAddress || request.ip_address || '127.0.0.1';
    const userAgent = request.userAgent || request.user_agent || 'Unknown-Device';

    const rateLimitKey = `rate:login:account:${normalizedIdentifier}`;

    // 1. Brute-Force Pre-Check in Redis
    const attemptsStr = await this.redisService.get(rateLimitKey);
    const currentAttempts = attemptsStr ? parseInt(attemptsStr, 10) : 0;
    if (currentAttempts >= 5) {
      const ttl = await this.redisService.ttl(rateLimitKey);
      const effectiveTtl = ttl > 0 ? ttl : 900;
      this.logger.warn(
        `[Login Lockout] Account "${normalizedIdentifier}" is locked for ${effectiveTtl}s`,
      );
      throw new RpcException({
        code: status.RESOURCE_EXHAUSTED,
        message: `Too many failed login attempts. Please try again after 15 minutes. [Retry-After: ${effectiveTtl}]`,
      });
    }

    // 2. User Query by email OR username
    const userRepository = this.dataSource.getRepository(User);
    const user = await userRepository.findOne({
      where: [
        { email: normalizedIdentifier.toLowerCase() },
        { username: normalizedIdentifier },
      ],
    });

    // 3. Timing Attack Defense (User Not Found)
    if (!user) {
      await bcrypt.compare(password, LoginProvider.DUMMY_BCRYPT_HASH);
      throw new RpcException({
        code: status.UNAUTHENTICATED,
        message: 'Invalid credentials',
      });
    }

    // 4. Account Status Validation
    if (user.status === UserStatus.PENDING) {
      throw new RpcException({
        code: status.FAILED_PRECONDITION,
        message: 'Account is not verified. Please verify your email first.',
      });
    }

    if (user.status === UserStatus.BLOCKED) {
      throw new RpcException({
        code: status.PERMISSION_DENIED,
        message: 'Account has been suspended.',
      });
    }

    // 5. Password Verification
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      let attempts = 1;
      try {
        attempts = await this.redisService.incr(rateLimitKey);
        if (attempts === 1 || attempts >= 5) {
          await this.redisService.expire(rateLimitKey, 900);
        }
      } catch (redisErr) {
        this.logger.error(
          `Failed to increment login rate limit for ${normalizedIdentifier}:`,
          redisErr,
        );
      }

      if (attempts >= 5) {
        this.logger.warn(
          `[Login Lockout Triggered] Account "${normalizedIdentifier}" reached 5 failures. Locking for 900s.`,
        );
        throw new RpcException({
          code: status.RESOURCE_EXHAUSTED,
          message: `Too many failed login attempts. Please try again after 15 minutes. [Retry-After: 900]`,
        });
      }

      const remaining = Math.max(0, 5 - attempts);
      throw new RpcException({
        code: status.UNAUTHENTICATED,
        message: `Invalid credentials. You have ${remaining} attempts remaining.`,
      });
    }

    // 6. Successful Authentication: Reset failure counter
    try {
      await this.redisService.del(rateLimitKey);
    } catch (delErr) {
      this.logger.error(
        `Failed to clear login rate limit for ${normalizedIdentifier}:`,
        delErr,
      );
    }

    // 7. Session Issuance & Dual-Token Generation
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

    const rawRefreshToken = crypto.randomBytes(32).toString('hex');
    const hashedRefreshToken = await bcrypt.hash(rawRefreshToken, 10);

    // Persist session atomically and enforce 5-device limit via Redis Lua script
    await this.redisService.saveSessionWithEviction({
      sessionId,
      userId: user.id,
      hashedRefreshToken,
      ipAddress,
      userAgent,
      maxDevices: 5,
      ttlSeconds: 7 * 24 * 60 * 60, // 7 days
    });

    this.logger.log(
      `User ${user.id} (${user.email}) logged in successfully from ${ipAddress}`,
    );

    return {
      success: true,
      message: 'Logged in successfully',
      data: {
        accessToken,
        refreshToken: rawRefreshToken,
        access_token: accessToken,
        refresh_token: rawRefreshToken,
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
