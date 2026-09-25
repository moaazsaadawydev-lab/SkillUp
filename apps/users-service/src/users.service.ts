import {
  Injectable,
  Logger,
} from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { User, OutboxMessage } from '@skillup/shared/entities';
import { UserRole, UserStatus, OutboxStatus } from '@skillup/shared/enums';
import { OUTBOX_EVENTS } from '@skillup/shared/constants';
import { RedisService } from '@skillup/shared/redis';
import { CreateUserRequest, CreateUserResponse } from '@skillup/shared/interfaces';
import { OutboxWorker } from './outbox/outbox.worker';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly redisService: RedisService,
    private readonly outboxWorker: OutboxWorker,
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
}
