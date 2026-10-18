import { Injectable, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { DataSource } from 'typeorm';
import * as crypto from 'crypto';
import { User, OutboxMessage } from '@skillup/shared/entities';
import { UserStatus, OutboxStatus } from '@skillup/shared/enums';
import { OUTBOX_EVENTS } from '@skillup/shared/constants';
import { RedisService } from '@skillup/shared/redis';
import {
  SendVerificationCodeRequest,
  ActionResponse,
} from '@skillup/shared/interfaces';
import { OutboxWorker } from '../outbox/outbox.worker';

@Injectable()
export class VerificationCodeProvider {
  private readonly logger = new Logger(VerificationCodeProvider.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly redisService: RedisService,
    private readonly outboxWorker: OutboxWorker,
  ) {}

  /**
   * Resend verification code:
   * 1. Validates 60-second cooldown via Redis.
   * 2. Finds user by email; ensures user exists and status is PENDING.
   * 3. Generates fresh cryptographically secure 6-digit OTP & hashes it (SHA-256).
   * 4. Overwrites/stores OTP in Redis with 10-minute TTL.
   * 5. Clears previous failed attempts / rate-limit counter in Redis.
   * 6. Creates Transactional Outbox event (`SEND_VERIFICATION_EMAIL`) and triggers outbox worker.
   */
  async sendVerificationCode(
    request: SendVerificationCodeRequest,
  ): Promise<ActionResponse> {
    const normalizedEmail = request.email.trim().toLowerCase();
    const redisOtpKey = `otp:verify:${normalizedEmail}`;
    const cooldownKey = `cooldown:verify:${normalizedEmail}`;
    const rateLimitKey = `rate:verify:${normalizedEmail}`;

    // 1. Pre-execution Check: Brute-force Lockout Guard
    const currentAttemptsStr = await this.redisService.get(rateLimitKey);
    const currentAttempts = currentAttemptsStr
      ? parseInt(currentAttemptsStr, 10)
      : 0;

    if (currentAttempts >= 7) {
      const remainingTtl = await this.redisService.ttl(rateLimitKey);
      const ttlSeconds = remainingTtl > 0 ? remainingTtl : 15 * 60;
      throw new RpcException({
        code: status.RESOURCE_EXHAUSTED,
        message: `Account is temporarily locked due to too many failed attempts. Please try again after 15 minutes. [Retry-After: ${ttlSeconds}]`,
      });
    }

    // 2. Cooldown Guard (60-second cooldown between resends)
    const isCooldownActive = await this.redisService.get(cooldownKey);
    if (isCooldownActive) {
      const remainingSeconds = await this.redisService.ttl(cooldownKey);
      const ttl = remainingSeconds > 0 ? remainingSeconds : 60;
      throw new RpcException({
        code: status.RESOURCE_EXHAUSTED,
        message: `Please wait ${ttl} seconds before requesting a new verification code. [Retry-After: ${ttl}]`,
      });
    }

    // 3. User Existence & Status Verification
    const user = await this.dataSource.getRepository(User).findOne({
      where: { email: normalizedEmail },
    });

    if (!user) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'No account registered with this email address.',
      });
    }

    if (user.status === UserStatus.ACTIVE) {
      throw new RpcException({
        code: status.FAILED_PRECONDITION,
        message: 'This account is already verified and active.',
      });
    }

    if (user.status !== UserStatus.PENDING) {
      throw new RpcException({
        code: status.PERMISSION_DENIED,
        message: 'This account is not eligible for verification.',
      });
    }

    // 4. Generate fresh 6-digit OTP & Hash with SHA-256
    const plainOtpCode = crypto.randomInt(100000, 1000000).toString();
    const hashedOtp = crypto
      .createHash('sha256')
      .update(plainOtpCode)
      .digest('hex');

    // Store in Redis: 10 minutes OTP TTL (600s), set 60-second cooldown, reset failed attempt count
    await Promise.all([
      this.redisService.setWithTtl(redisOtpKey, hashedOtp, 600),
      this.redisService.setWithTtl(cooldownKey, '1', 60),
      this.redisService.del(rateLimitKey),
      this.redisService.del(`otp:attempts:${normalizedEmail}`),
    ]);

    // 5. Database Outbox Event creation
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
