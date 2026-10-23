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
import { LoginProvider } from '../../src/users/providers/login.provider';
import { MediaController } from '../../src/media/media.controller';
import { MediaService } from '../../src/media/media.service';
import { UploadUrlProvider } from '../../src/media/providers/upload-url.provider';
import { FileQueryProvider } from '../../src/media/providers/file-query.provider';
import { IpRateLimitGuard } from '../../src/common/guards/ip-rate-limit.guard';
import { AllExceptionsFilter } from '@skillup/shared/common';
import { USERS_SERVICE_NAME, MEDIA_SERVICE_NAME } from '@skillup/shared/interfaces';
import { RedisService } from '@skillup/shared/redis';
import { MockRedis, createMockUsersServiceClient, createMockMediaServiceClient } from '../test-helpers';

describe('Integration Tests: Edge IP Rate Limiter, Lockouts & High-Load Stress', () => {
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
        LoginProvider,
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
    const expressApp = app.getHttpAdapter().getInstance();
    expressApp.set('trust proxy', 1);
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

  describe('Edge IP Rate Limiting Policies', () => {
    it('Registration Endpoint: should allow exactly 5 requests / 15m from same IP and block 6th with 429', async () => {
      const clientIp = '198.51.100.1';

      // Send 5 requests
      for (let i = 1; i <= 5; i++) {
        const res = await request(app.getHttpServer())
          .post('/api/v1/users/auth/register')
          .set('x-forwarded-for', clientIp)
          .send({
            username: `user_${i}`,
            email: `user_${i}@skillup.com`,
            password: 'Password123!',
          });

        expect(res.status).toBe(201);
        expect(res.headers['x-ratelimit-limit']).toBe('5');
        expect(res.headers['x-ratelimit-remaining']).toBe((5 - i).toString());
      }

      // 6th request from the same IP must be BLOCKED
      const blockedRes = await request(app.getHttpServer())
        .post('/api/v1/users/auth/register')
        .set('x-forwarded-for', clientIp)
        .send({
          username: 'user_6',
          email: 'user_6@skillup.com',
          password: 'Password123!',
        });

      expect(blockedRes.status).toBe(429);
      expect(blockedRes.body.statusCode).toBe(429);
      expect(blockedRes.body.message).toContain('Too many requests');
      expect(blockedRes.headers['retry-after']).toBeDefined();
      expect(blockedRes.headers['x-ratelimit-remaining']).toBe('0');
    });

    it('Avatar Upload URL: should enforce 10 requests / 15m limit per IP', async () => {
      const clientIp = '198.51.100.2';

      for (let i = 1; i <= 10; i++) {
        const res = await request(app.getHttpServer())
          .post('/api/v1/media/avatar/upload-url')
          .set('x-forwarded-for', clientIp)
          .send({
            filename: `avatar_${i}.jpg`,
            contentType: 'image/jpeg',
            fileSize: 1024 * 100,
          });

        expect(res.status).toBe(200);
        expect(res.headers['x-ratelimit-remaining']).toBe((10 - i).toString());
      }

      // 11th request must be BLOCKED
      const blockedRes = await request(app.getHttpServer())
        .post('/api/v1/media/avatar/upload-url')
        .set('x-forwarded-for', clientIp)
        .send({
          filename: 'avatar_11.jpg',
          contentType: 'image/jpeg',
          fileSize: 1024 * 100,
        });

      expect(blockedRes.status).toBe(429);
      expect(blockedRes.headers['retry-after']).toBeDefined();
    });

    it('Verification Code Resend: should enforce 5 requests / 15m limit per IP', async () => {
      const clientIp = '198.51.100.3';

      for (let i = 1; i <= 5; i++) {
        const res = await request(app.getHttpServer())
          .post('/api/v1/users/auth/send-verification-code')
          .set('x-forwarded-for', clientIp)
          .send({ email: `student_${i}@skillup.com` });

        expect(res.status).toBe(200);
      }

      const blockedRes = await request(app.getHttpServer())
        .post('/api/v1/users/auth/send-verification-code')
        .set('x-forwarded-for', clientIp)
        .send({ email: 'student_6@skillup.com' });

      expect(blockedRes.status).toBe(429);
      expect(blockedRes.headers['retry-after']).toBeDefined();
    });

    it('Anti-Spoofing (SEC-001): should prevent IP spoofing by ignoring forged X-Forwarded-For headers', async () => {
      const realClientIp = '198.51.100.99';

      // Attacker attempts to bypass IP rate limiting by prepending spoofed IPs in X-Forwarded-For
      for (let i = 1; i <= 5; i++) {
        const res = await request(app.getHttpServer())
          .post('/api/v1/users/auth/register')
          .set('x-forwarded-for', `spoofed.${i}.com, ${realClientIp}`)
          .send({
            username: `spoof_user_${i}`,
            email: `spoof_${i}@skillup.com`,
            password: 'Password123!',
          });

        expect(res.status).toBe(201);
      }

      // 6th attempt with another spoofed prepended IP MUST be blocked because Express trusts 1 hop (realClientIp)
      const blockedRes = await request(app.getHttpServer())
        .post('/api/v1/users/auth/register')
        .set('x-forwarded-for', `spoofed.6.com, ${realClientIp}`)
        .send({
          username: 'spoof_user_6',
          email: 'spoof_6@skillup.com',
          password: 'Password123!',
        });

      expect(blockedRes.status).toBe(429);
      expect(blockedRes.body.statusCode).toBe(429);
      expect(blockedRes.body.message).toContain('Too many requests from this IP address');
      expect(blockedRes.headers['retry-after']).toBeDefined();
    });

    it('Distributed Botnet Defense (SEC-003): should block distributed attack targeting the SAME email on 6th attempt across 50 distinct IPs', async () => {
      const targetEmail = 'ceo@target-corporation.com';

      // 5 attempts from 5 distinct IPs targeting the same email must succeed
      for (let i = 1; i <= 5; i++) {
        const res = await request(app.getHttpServer())
          .post('/api/v1/users/auth/register')
          .set('x-forwarded-for', `185.220.101.${i}`) // distinct botnet IPs
          .send({
            username: `bot_user_${i}`,
            email: targetEmail,
            password: 'Password123!',
          });

        expect(res.status).toBe(201);
      }

      // 6th through 50th attempts from completely different IPs targeting the same email MUST be BLOCKED by email-level rate limiting
      for (let i = 6; i <= 50; i++) {
        const res = await request(app.getHttpServer())
          .post('/api/v1/users/auth/register')
          .set('x-forwarded-for', `185.220.101.${i}`) // distinct botnet IP
          .send({
            username: `bot_user_${i}`,
            email: targetEmail,
            password: 'Password123!',
          });

        expect(res.status).toBe(429);
        expect(res.body.statusCode).toBe(429);
        expect(res.body.message).toContain('targeting this account');
        expect(res.headers['retry-after']).toBeDefined();
        expect(res.headers['x-ratelimit-remaining']).toBe('0');
      }
    });
  });

  describe('Brute-Force OTP Lockout (7 Failed Attempts / 15-Minute Freeze)', () => {
    it('should track failed OTP attempts and lock account for 15 minutes after 7 failures', async () => {
      let attempts = 0;
      mockUsersClient.verifyAccount.mockImplementation(() => {
        attempts++;
        if (attempts < 7) {
          const remaining = 7 - attempts;
          return throwError(() => ({
            code: 3,
            details: `Invalid verification code. You have ${remaining} attempts remaining.`,
          }));
        }
        return throwError(() => ({
          code: 8,
          details: 'Too many failed verification attempts. Please try again after 15 minutes. [Retry-After: 900]',
        }));
      });

      // Submit 6 failed attempts
      for (let i = 1; i <= 6; i++) {
        const res = await request(app.getHttpServer())
          .post('/api/v1/users/auth/verify-account')
          .set('x-forwarded-for', `10.200.0.${i}`) // vary IP to isolate account lockout from IP limit
          .send({
            email: 'victim@skillup.com',
            code: '000000',
          });

        expect(res.status).toBe(400);
        expect(res.body.message).toContain('attempts remaining');
      }

      // 7th attempt triggers the 15-minute freeze
      const lockedRes = await request(app.getHttpServer())
        .post('/api/v1/users/auth/verify-account')
        .set('x-forwarded-for', '10.200.0.7')
        .send({
          email: 'victim@skillup.com',
          code: '000000',
        });

      expect(lockedRes.status).toBe(429);
      expect(lockedRes.body.statusCode).toBe(429);
      expect(lockedRes.body.message).toContain('Too many failed verification attempts');
      expect(lockedRes.headers['retry-after']).toBe('900');
    });
  });

  describe('Brute-Force Login Lockout (5 Failed Attempts / 15-Minute Freeze)', () => {
    it('should track failed password attempts and lock account for 15 minutes after 5 failures', async () => {
      let attempts = 0;
      mockUsersClient.login.mockImplementation(() => {
        attempts++;
        if (attempts < 5) {
          const remaining = 5 - attempts;
          return throwError(() => ({
            code: 16,
            details: `Invalid credentials. You have ${remaining} attempts remaining.`,
          }));
        }
        return throwError(() => ({
          code: 8,
          details: 'Too many failed login attempts. Please try again after 15 minutes. [Retry-After: 900]',
        }));
      });

      // Submit 4 failed attempts from distinct IPs
      for (let i = 1; i <= 4; i++) {
        const res = await request(app.getHttpServer())
          .post('/api/v1/users/auth/login')
          .set('x-forwarded-for', `10.201.0.${i}`)
          .send({
            identifier: 'locked.target@skillup.com',
            password: 'WrongPassword123!',
          });

        expect(res.status).toBe(401);
        expect(res.body.message).toContain('attempts remaining');
      }

      // 5th attempt triggers lockout
      const fifthRes = await request(app.getHttpServer())
        .post('/api/v1/users/auth/login')
        .set('x-forwarded-for', '10.201.0.5')
        .send({
          identifier: 'locked.target@skillup.com',
          password: 'WrongPassword123!',
        });

      expect(fifthRes.status).toBe(429);
      expect(fifthRes.body.statusCode).toBe(429);
      expect(fifthRes.body.message).toContain('Too many failed login attempts');
      expect(fifthRes.headers['retry-after']).toBe('900');

      // 6th attempt is blocked immediately by the 15-minute freeze
      const sixthRes = await request(app.getHttpServer())
        .post('/api/v1/users/auth/login')
        .set('x-forwarded-for', '10.201.0.6')
        .send({
          identifier: 'locked.target@skillup.com',
          password: 'WrongPassword123!',
        });

      expect(sixthRes.status).toBe(429);
      expect(sixthRes.body.statusCode).toBe(429);
      expect(
        sixthRes.body.message.includes('Too many failed login attempts') ||
          sixthRes.body.message.includes('Too many requests targeting this account'),
      ).toBe(true);
      expect(sixthRes.headers['retry-after']).toBe('900');
    });
  });

  describe('High-Load & Stress Simulation (Burst of 100 Concurrent Requests)', () => {
    it('Stress Test: should handle a high-concurrency burst of 100 requests without crashes or memory leakage', async () => {
      const startTime = Date.now();

      // Launch 100 requests simultaneously to media upload URL with distinct IPs
      const burstRequests = Array.from({ length: 100 }, (_, i) =>
        request(app.getHttpServer())
          .post('/api/v1/media/upload-url')
          .set('x-forwarded-for', `10.50.${Math.floor(i / 20)}.${(i % 20) + 1}`)
          .send({
            filename: `stress_test_${i}.jpg`,
            contentType: 'image/jpeg',
            fileSize: 1024 * 50,
            category: 'STRESS',
          }),
      );

      const responses = await Promise.all(burstRequests);
      const durationMs = Date.now() - startTime;

      // Verify all responses completed successfully
      const status200Count = responses.filter((r) => r.status === 200).length;
      expect(status200Count).toBe(100);

      // Verify latency under load: 100 requests processed in under 3 seconds
      expect(durationMs).toBeLessThan(3000);

      // Verify consistency of response structures
      for (const res of responses) {
        expect(res.body.success).toBe(true);
        expect(res.body.data.uploadUrl).toBeDefined();
        expect(res.headers['x-ratelimit-limit']).toBe('20');
      }
    });

    it('Stress Test: should enforce IP rate limit accurately during a concurrent burst of 50 requests from a single attacker IP', async () => {
      const attackerIp = '203.0.113.88';

      // Attacker fires 50 concurrent requests at the register endpoint
      const attackerRequests = Array.from({ length: 50 }, (_, i) =>
        request(app.getHttpServer())
          .post('/api/v1/users/auth/register')
          .set('x-forwarded-for', attackerIp)
          .send({
            username: `attacker_bot_${i}`,
            email: `bot_${i}@attacker.com`,
            password: 'Password123!',
          }),
      );

      const responses = await Promise.all(attackerRequests);

      const accepted = responses.filter((r) => r.status === 201);
      const blocked = responses.filter((r) => r.status === 429);

      // Exactly 5 should be accepted, exactly 45 should be blocked
      expect(accepted.length).toBe(5);
      expect(blocked.length).toBe(45);

      for (const b of blocked) {
        expect(b.body.statusCode).toBe(429);
        expect(b.headers['retry-after']).toBeDefined();
      }
    });
  });
});
