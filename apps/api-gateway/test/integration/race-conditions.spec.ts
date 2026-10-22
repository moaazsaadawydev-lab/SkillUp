import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { of, throwError } from 'rxjs';
import { AuthController } from '../../src/users/auth.controller';
import { AuthService } from '../../src/users/auth.service';
import { RegistrationProvider } from '../../src/users/providers/registration.provider';
import { AccountVerificationProvider } from '../../src/users/providers/account-verification.provider';
import { VerificationCodeProvider } from '../../src/users/providers/verification-code.provider';
import { MediaController } from '../../src/media/media.controller';
import { MediaService } from '../../src/media/media.service';
import { UploadUrlProvider } from '../../src/media/providers/upload-url.provider';
import { FileQueryProvider } from '../../src/media/providers/file-query.provider';
import { IpRateLimitGuard } from '../../src/common/guards/ip-rate-limit.guard';
import { AllExceptionsFilter } from '@skillup/shared/common';
import { USERS_SERVICE_NAME, MEDIA_SERVICE_NAME } from '@skillup/shared/interfaces';
import { RedisService } from '@skillup/shared/redis';
import { MockRedis, createMockUsersServiceClient, createMockMediaServiceClient } from '../test-helpers';

describe('Integration Tests: Race Conditions & Concurrency Controls', () => {
  let app: INestApplication;
  let mockRedis: MockRedis;
  let mockUsersClient: any;
  let mockMediaClient: any;

  beforeAll(async () => {
    mockRedis = new MockRedis();
    mockUsersClient = createMockUsersServiceClient();
    mockMediaClient = createMockMediaServiceClient();

    const mockUsersGrpc = {
      getService: () => mockUsersClient,
    };
    const mockMediaGrpc = {
      getService: () => mockMediaClient,
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [AuthController, MediaController],
      providers: [
        AuthService,
        MediaService,
        RegistrationProvider,
        AccountVerificationProvider,
        VerificationCodeProvider,
        UploadUrlProvider,
        FileQueryProvider,
        {
          provide: USERS_SERVICE_NAME,
          useValue: mockUsersGrpc,
        },
        {
          provide: MEDIA_SERVICE_NAME,
          useValue: mockMediaGrpc,
        },
        {
          provide: RedisService,
          useValue: mockRedis,
        },
        {
          provide: APP_GUARD,
          useClass: IpRateLimitGuard,
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    mockRedis.clear();
    jest.clearAllMocks();
  });

  describe('Race Condition 1: Single-Use Presigned Token Consumption', () => {
    it('should allow only ONE registration to consume a temp avatar token, rejecting concurrent replays', async () => {
      const tempKey = 'temp_uploads/avatars/race-avatar-1.jpg';
      await mockRedis.set(`upload:temp:${tempKey}`, 'PENDING', 'EX', 120);

      // Create two concurrent requests trying to register with the exact same tempPhotoKey
      // We simulate distinct IPs to bypass IP-rate limiting during this race test
      const sendReg = (username: string, email: string, ip: string) =>
        request(app.getHttpServer())
          .post('/api/v1/users/auth/register')
          .set('x-forwarded-for', ip)
          .send({
            username,
            email,
            password: 'Password123!',
            tempPhotoKey: tempKey,
          });

      // Execute sequentially or concurrently: first wins, second must be rejected
      const res1 = await sendReg('userOne', 'user1@skillup.com', '10.0.0.1');
      expect(res1.status).toBe(201);
      expect(res1.body.success).toBe(true);

      // Verify Redis token has transitioned to CONSUMED
      const tokenState = await mockRedis.get(`upload:temp:${tempKey}`);
      expect(tokenState).toBe('CONSUMED');

      // Second attempt with same token MUST fail with 409 Conflict
      const res2 = await sendReg('userTwo', 'user2@skillup.com', '10.0.0.2');
      expect(res2.status).toBe(409);
      expect(res2.body.message).toContain('already been consumed');
    });
  });

  describe('Race Condition 2: Concurrent Duplicate Email Registrations', () => {
    it('should handle concurrent registrations for the same email atomically, allowing only 1 winner', async () => {
      let registeredCount = 0;
      mockUsersClient.createUser.mockImplementation((payload: any) => {
        if (registeredCount > 0) {
          return throwError(() => ({
            code: 6,
            details: 'User with this email already exists',
          }));
        }
        registeredCount++;
        return of({
          success: true,
          message: 'Verification code sent',
          userId: 'user-winner-id',
        });
      });

      // Fire 5 concurrent requests with the same email from different IPs
      const requests = Array.from({ length: 5 }, (_, i) =>
        request(app.getHttpServer())
          .post('/api/v1/users/auth/register')
          .set('x-forwarded-for', `192.168.10.${i + 1}`)
          .send({
            username: `candidate_${i}`,
            email: 'simultaneous@skillup.com',
            password: 'Password123!',
          }),
      );

      const responses = await Promise.all(requests);
      const successful = responses.filter((r) => r.status === 201);
      const conflicts = responses.filter((r) => r.status === 409);

      expect(successful.length).toBe(1);
      expect(conflicts.length).toBe(4);
      for (const conf of conflicts) {
        expect(conf.body.statusCode).toBe(409);
        expect(conf.body.message).toContain('already exists');
      }
    });
  });

  describe('Race Condition 3: Concurrent Account Verification & OTP Consumption', () => {
    it('should atomically process verification and prevent double-activation or re-use of consumed OTP', async () => {
      let activationCount = 0;
      mockUsersClient.verifyAccount.mockImplementation(() => {
        if (activationCount > 0) {
          return throwError(() => ({
            code: 9, // FAILED_PRECONDITION
            details: 'Account is already active.',
          }));
        }
        activationCount++;
        return of({
          success: true,
          message: 'Account verified successfully',
          data: {
            accessToken: 'token-active',
            refreshToken: 'refresh-active',
            user: { id: 'user-1' },
          },
        });
      });

      // Fire 4 parallel verify requests with identical code from different IPs
      const requests = Array.from({ length: 4 }, (_, i) =>
        request(app.getHttpServer())
          .post('/api/v1/users/auth/verify-account')
          .set('x-forwarded-for', `10.10.10.${i + 1}`)
          .send({
            email: 'verify-race@skillup.com',
            code: '123456',
          }),
      );

      const responses = await Promise.all(requests);
      const successes = responses.filter((r) => r.status === 200);
      const rejected = responses.filter((r) => r.status === 400);

      expect(successes.length).toBe(1);
      expect(rejected.length).toBe(3);
      for (const rej of rejected) {
        expect(rej.body.message).toContain('already active');
      }
    });
  });

  describe('Race Condition 4: Concurrent Verification Code Resend (Cooldown Guard)', () => {
    it('should enforce 60s cooldown atomically when multiple resend requests arrive simultaneously', async () => {
      let resendCount = 0;
      mockUsersClient.sendVerificationCode.mockImplementation(() => {
        if (resendCount > 0) {
          return throwError(() => ({
            code: 8, // RESOURCE_EXHAUSTED
            details: 'Please wait 60 seconds before requesting a new verification code. [Retry-After: 60]',
          }));
        }
        resendCount++;
        return of({
          success: true,
          message: 'A new verification code has been sent',
        });
      });

      // Send 3 concurrent resends from different IPs
      const requests = Array.from({ length: 3 }, (_, i) =>
        request(app.getHttpServer())
          .post('/api/v1/users/auth/send-verification-code')
          .set('x-forwarded-for', `172.16.0.${i + 1}`)
          .send({
            email: 'resend-race@skillup.com',
          }),
      );

      const responses = await Promise.all(requests);
      const successes = responses.filter((r) => r.status === 200);
      const throttled = responses.filter((r) => r.status === 429);

      expect(successes.length).toBe(1);
      expect(throttled.length).toBe(2);
      for (const t of throttled) {
        expect(t.body.statusCode).toBe(429);
        expect(t.headers['retry-after']).toBe('60');
      }
    });
  });
});
