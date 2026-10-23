import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import request from 'supertest';
import cookieParser from 'cookie-parser';
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

describe('Integration Tests: Happy Paths for All Endpoints', () => {
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
  });

  describe('1. POST /api/v1/media/avatar/upload-url', () => {
    it('Happy Path: should return 200 OK with presigned upload URL and rate limit headers', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/media/avatar/upload-url')
        .send({
          filename: 'profile-pic.png',
          contentType: 'image/png',
          fileSize: 1024 * 300, // 300 KB
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('uploadUrl');
      expect(response.body.data).toHaveProperty('fileKey');
      expect(response.body.data.expiresIn).toBe(120);
      expect(response.headers['x-ratelimit-limit']).toBe('10');
      expect(response.headers['x-ratelimit-remaining']).toBe('9');
    });
  });

  describe('2. POST /api/v1/media/upload-url', () => {
    it('Happy Path: should return 200 OK for general upload URL request', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/media/upload-url')
        .send({
          filename: 'course-cover.webp',
          contentType: 'image/webp',
          fileSize: 1024 * 800,
          category: 'COURSE_THUMBNAIL',
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.uploadUrl).toBeDefined();
      expect(response.headers['x-ratelimit-limit']).toBe('20');
    });
  });

  describe('3. GET /api/v1/media/file-url?key=...', () => {
    it('Happy Path: should return 200 OK and temporary access URL for existing file', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/media/file-url')
        .query({ key: 'avatars/user-123/avatar.webp' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.url).toContain('avatars/user-123/avatar.webp');
      expect(response.body.data.expiresIn).toBe(3600);
    });
  });

  describe('4. GET /api/v1/media/check-file?key=...', () => {
    it('Happy Path: should return 200 OK and file metadata if file exists in storage', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/media/check-file')
        .query({ key: 'temp_uploads/avatars/valid-avatar.jpg' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.exists).toBe(true);
      expect(response.body.data.fileSize).toBe(50 * 1024);
      expect(response.body.data.contentType).toBe('image/jpeg');
    });
  });

  describe('5. POST /api/v1/users/auth/register', () => {
    it('Happy Path: should return 201 Created when registering without avatar', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/users/auth/register')
        .send({
          username: 'happy_student',
          email: 'happy.student@skillup.com',
          password: 'Password123!',
          birthDate: '1998-05-15',
        })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.userId).toBeDefined();
      expect(response.body.message).toContain('Verification code sent');
      expect(response.headers['x-ratelimit-limit']).toBe('5');
    });

    it('Happy Path: should return 201 Created when registering with valid tempPhotoKey', async () => {
      const tempKey = 'temp_uploads/avatars/my-profile.jpg';
      await mockRedis.set(`upload:temp:${tempKey}`, 'PENDING', 'EX', 120);

      const response = await request(app.getHttpServer())
        .post('/api/v1/users/auth/register')
        .send({
          username: 'photouser',
          email: 'photouser@skillup.com',
          password: 'Password123!',
          tempPhotoKey: tempKey,
          cropX: 10,
          cropY: 10,
          cropWidth: 400,
          cropHeight: 400,
        })
        .expect(201);

      expect(response.body.success).toBe(true);
      const consumedStatus = await mockRedis.get(`upload:temp:${tempKey}`);
      expect(consumedStatus).toBe('CONSUMED');
    });
  });

  describe('6. POST /api/v1/users/auth/verify-account', () => {
    it('Happy Path: should return 200 OK, accessToken, user profile, and Set-Cookie refresh_token', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/users/auth/verify-account')
        .send({
          email: 'happy.student@skillup.com',
          code: '123456',
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.accessToken).toBeDefined();
      expect(response.body.data.user.email).toBe('happy.student@skillup.com');

      // Check cookie
      const rawCookies = response.headers['set-cookie'];
      const cookieArray = Array.isArray(rawCookies) ? rawCookies : [rawCookies];
      expect(cookieArray.some((c: any) => typeof c === 'string' && c.includes('refresh_token=') && c.includes('HttpOnly'))).toBe(true);
    });
  });

  describe('7. POST /api/v1/users/auth/send-verification-code', () => {
    it('Happy Path: should return 200 OK when requesting OTP resend', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/users/auth/send-verification-code')
        .send({
          email: 'happy.student@skillup.com',
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('verification code has been sent');
    });
  });

  describe('8. POST /api/v1/users/auth/login', () => {
    it('Happy Path: should authenticate via email and return 200 OK + accessToken + Set-Cookie refresh_token', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/users/auth/login')
        .send({
          identifier: 'happy.student@skillup.com',
          password: 'Password123!',
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('Logged in successfully');
      expect(response.body.data.accessToken).toBeDefined();
      expect(response.body.data.user.email).toBe('happy.student@skillup.com');

      const rawCookies = response.headers['set-cookie'];
      const cookieArray = Array.isArray(rawCookies) ? rawCookies : [rawCookies];
      expect(
        cookieArray.some(
          (c: any) =>
            typeof c === 'string' &&
            c.includes('refresh_token=') &&
            c.includes('HttpOnly'),
        ),
      ).toBe(true);
    });

    it('Happy Path: should authenticate via username and return 200 OK', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/users/auth/login')
        .send({
          identifier: 'happystudent',
          password: 'Password123!',
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.accessToken).toBeDefined();
      expect(response.body.data.user.username).toBe('happystudent');
    });
  });
});
