import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { throwError } from 'rxjs';
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

describe('Integration Tests: Edge Cases, Security & XSS Injections', () => {
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

  describe('XSS Attack Vectors & Injection Defenses', () => {
    it('Security: should reject script injection in email during registration', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/users/auth/register')
        .send({
          username: 'validuser',
          email: '<script>alert("xss")</script>@domain.com',
          password: 'Password123!',
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.statusCode).toBe(400);
      expect(JSON.stringify(response.body.message)).toContain('email');
    });

    it('Security: should reject script injection in verification code', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/users/auth/verify-account')
        .send({
          email: 'valid@skillup.com',
          code: '<script>alert(1)</script>',
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(JSON.stringify(response.body.message)).toContain('code');
    });

    it('Security: should reject path traversal and HTML/Script injection in tempPhotoKey', async () => {
      const payloads = [
        'temp_uploads/avatars/<script>alert(1)</script>',
        'temp_uploads/avatars/../../etc/passwd',
        'temp_uploads/avatars/"; DROP TABLE users;--',
      ];

      for (const tempPhotoKey of payloads) {
        const response = await request(app.getHttpServer())
          .post('/api/v1/users/auth/register')
          .send({
            username: 'validuser',
            email: 'valid@skillup.com',
            password: 'Password123!',
            tempPhotoKey,
          })
          .expect(400);

        expect(response.body.success).toBe(false);
      }
    });

    it('Security: should reject executable and dangerous MIME types in upload-url', async () => {
      const dangerousTypes = [
        'text/html',
        'application/javascript',
        'application/x-sh',
        'image/svg+xml',
      ];

      for (const contentType of dangerousTypes) {
        const response = await request(app.getHttpServer())
          .post('/api/v1/media/avatar/upload-url')
          .send({
            filename: 'test.png',
            contentType,
            fileSize: 1024 * 100,
          })
          .expect(400);

        expect(response.body.success).toBe(false);
        expect(JSON.stringify(response.body.message)).toContain('contentType');
      }
    });
  });

  describe('Strict Payload Enforcement (forbidNonWhitelisted)', () => {
    it('Security: should reject requests containing unknown/injected properties (mass assignment prevention)', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/users/auth/register')
        .send({
          username: 'validuser',
          email: 'valid@skillup.com',
          password: 'Password123!',
          isAdmin: true,
          role: 'ADMIN',
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(JSON.stringify(response.body.message)).toContain('should not exist');
    });
  });

  describe('Boundary Limit Validations', () => {
    it('Edge Case: should reject password with 7 characters (min length is 8)', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/users/auth/register')
        .send({
          username: 'validuser',
          email: 'valid@skillup.com',
          password: 'Pass123', // 7 chars
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(JSON.stringify(response.body.message)).toContain('at least 8 characters');
    });

    it('Edge Case: should reject verification code with 5 or 7 digits (must be exactly 6)', async () => {
      for (const code of ['12345', '1234567']) {
        const response = await request(app.getHttpServer())
          .post('/api/v1/users/auth/verify-account')
          .send({
            email: 'valid@skillup.com',
            code,
          })
          .expect(400);

        expect(response.body.success).toBe(false);
      }
    });

    it('Edge Case: should reject file size of 0 or exceeding 5MB', async () => {
      const responseZero = await request(app.getHttpServer())
        .post('/api/v1/media/avatar/upload-url')
        .send({
          filename: 'photo.jpg',
          contentType: 'image/jpeg',
          fileSize: 0,
        })
        .expect(400);
      expect(responseZero.body.success).toBe(false);

      const responseExceed = await request(app.getHttpServer())
        .post('/api/v1/media/avatar/upload-url')
        .send({
          filename: 'photo.jpg',
          contentType: 'image/jpeg',
          fileSize: 5 * 1024 * 1024 + 1,
        })
        .expect(400);
      expect(responseExceed.body.success).toBe(false);
    });

    it('Edge Case: should reject missing query param "key" on file retrieval and checking', async () => {
      const resFileUrl = await request(app.getHttpServer())
        .get('/api/v1/media/file-url')
        .expect(400);
      expect(resFileUrl.body.message).toContain('required');

      const resCheck = await request(app.getHttpServer())
        .get('/api/v1/media/check-file')
        .expect(400);
      expect(resCheck.body.message).toContain('required');
    });
  });

  describe('Business Conflict & Precondition Edge Cases', () => {
    it('Conflict: should return 409 Conflict when user already exists', async () => {
      jest.spyOn(mockUsersClient, 'createUser').mockReturnValueOnce(
        throwError(() => ({
          code: 6,
          details: 'User with this email already exists',
        })),
      );

      const response = await request(app.getHttpServer())
        .post('/api/v1/users/auth/register')
        .send({
          username: 'existinguser',
          email: 'duplicate@skillup.com',
          password: 'Password123!',
        })
        .expect(409);

      expect(response.body.success).toBe(false);
      expect(response.body.statusCode).toBe(409);
      expect(response.body.message).toContain('already exists');
    });

    it('Not Found: should return 404 Not Found when activating non-existent user', async () => {
      jest.spyOn(mockUsersClient, 'verifyAccount').mockReturnValueOnce(
        throwError(() => ({
          code: 5,
          details: 'User not found',
        })),
      );

      const response = await request(app.getHttpServer())
        .post('/api/v1/users/auth/verify-account')
        .send({
          email: 'ghost@skillup.com',
          code: '123456',
        })
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.statusCode).toBe(404);
    });

    it('Precondition Failed: should return 400 Bad Request when account is already active', async () => {
      jest.spyOn(mockUsersClient, 'verifyAccount').mockReturnValueOnce(
        throwError(() => ({
          code: 9,
          details: 'Account is already active.',
        })),
      );

      const response = await request(app.getHttpServer())
        .post('/api/v1/users/auth/verify-account')
        .send({
          email: 'active@skillup.com',
          code: '123456',
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('already active');
    });
  });

  describe('Login Security & Error Handling', () => {
    it('Wrong password: should return 401 Unauthorized with remaining attempts count', async () => {
      jest.spyOn(mockUsersClient, 'login').mockReturnValueOnce(
        throwError(() => ({
          code: 16,
          details: 'Invalid credentials. You have 4 attempts remaining.',
        })),
      );

      const response = await request(app.getHttpServer())
        .post('/api/v1/users/auth/login')
        .send({
          identifier: 'user@skillup.com',
          password: 'WrongPassword123!',
        })
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.statusCode).toBe(401);
      expect(response.body.message).toContain('4 attempts remaining');
    });

    it('Non-existent user: should return 401 Unauthorized (timing attack defense)', async () => {
      jest.spyOn(mockUsersClient, 'login').mockReturnValueOnce(
        throwError(() => ({
          code: 16,
          details: 'Invalid credentials',
        })),
      );

      const response = await request(app.getHttpServer())
        .post('/api/v1/users/auth/login')
        .send({
          identifier: 'nonexistent@skillup.com',
          password: 'Password123!',
        })
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.statusCode).toBe(401);
      expect(response.body.message).toBe('Invalid credentials');
    });

    it('Inactive user (PENDING): should return 400 Bad Request', async () => {
      jest.spyOn(mockUsersClient, 'login').mockReturnValueOnce(
        throwError(() => ({
          code: 9,
          details: 'Account is not verified. Please verify your email first.',
        })),
      );

      const response = await request(app.getHttpServer())
        .post('/api/v1/users/auth/login')
        .send({
          identifier: 'pending@skillup.com',
          password: 'Password123!',
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.statusCode).toBe(400);
      expect(response.body.message).toContain('not verified');
    });

    it('Suspended user (BLOCKED): should return 403 Forbidden', async () => {
      jest.spyOn(mockUsersClient, 'login').mockReturnValueOnce(
        throwError(() => ({
          code: 7,
          details: 'Account has been suspended.',
        })),
      );

      const response = await request(app.getHttpServer())
        .post('/api/v1/users/auth/login')
        .send({
          identifier: 'blocked@skillup.com',
          password: 'Password123!',
        })
        .expect(403);

      expect(response.body.success).toBe(false);
      expect(response.body.statusCode).toBe(403);
      expect(response.body.message).toContain('suspended');
    });
  });
});
