import {
  ExecutionContext,
  HttpException,
  HttpStatus,
  BadRequestException,
  ConflictException,
  NotFoundException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IpRateLimitGuard } from '../../src/common/guards/ip-rate-limit.guard';
import { RegistrationProvider } from '../../src/users/providers/registration.provider';
import { AccountVerificationProvider } from '../../src/users/providers/account-verification.provider';
import { VerificationCodeProvider } from '../../src/users/providers/verification-code.provider';
import { LoginProvider } from '../../src/users/providers/login.provider';
import { UploadUrlProvider } from '../../src/media/providers/upload-url.provider';
import { FileQueryProvider } from '../../src/media/providers/file-query.provider';
import { MockRedis, createMockUsersServiceClient, createMockMediaServiceClient } from '../test-helpers';
import { of, throwError } from 'rxjs';

describe('Unit Tests: Guards & Providers Logic', () => {
  describe('IpRateLimitGuard', () => {
    let guard: IpRateLimitGuard;
    let reflector: Reflector;
    let mockRedis: MockRedis;

    beforeEach(() => {
      reflector = new Reflector();
      mockRedis = new MockRedis();
      guard = new IpRateLimitGuard(reflector, mockRedis as any);
    });

    function createMockContext(ipHeader?: string, clientIp = '192.168.1.100', body?: any) {
      const headers: Record<string, string> = {};
      if (ipHeader) {
        headers['x-forwarded-for'] = ipHeader;
      }
      const responseHeaders: Record<string, string> = {};

      const req: any = {
        headers,
        ip: clientIp,
        socket: { remoteAddress: clientIp },
        body: body || {},
      };
      const res: any = {
        setHeader: jest.fn((k: string, v: string) => {
          responseHeaders[k] = v;
        }),
      };

      const context = {
        getHandler: () => ({}),
        getClass: () => ({}),
        switchToHttp: () => ({
          getRequest: () => req,
          getResponse: () => res,
        }),
      } as unknown as ExecutionContext;

      return { context, req, res, responseHeaders };
    }

    it('should bypass guard if @RateLimit decorator is not present on route', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(null);
      const { context } = createMockContext();

      const result = await guard.canActivate(context);
      expect(result).toBe(true);
    });

    it('should extract client IP safely from req.ip and strip IPv6 prefix', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue({
        limit: 5,
        ttl: 900,
        prefix: 'test-ip',
      });
      const { context, responseHeaders } = createMockContext(undefined, '::ffff:203.0.113.195');

      const result = await guard.canActivate(context);
      expect(result).toBe(true);
      expect(responseHeaders['X-RateLimit-Limit']).toBe('5');
      expect(responseHeaders['X-RateLimit-Remaining']).toBe('4');
    });

    it('should ignore forged X-Forwarded-For headers and rely on sanitized req.ip (SEC-001)', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue({
        limit: 2,
        ttl: 900,
        prefix: 'spoof-defense',
      });
      const realIp = '198.51.100.50';

      // Attacker attempts to forge X-Forwarded-For with different IPs on every request
      const { context: req1 } = createMockContext('1.1.1.1', realIp);
      const { context: req2 } = createMockContext('2.2.2.2', realIp);
      const { context: req3 } = createMockContext('3.3.3.3', realIp);

      await guard.canActivate(req1);
      await guard.canActivate(req2);
      await expect(guard.canActivate(req3)).rejects.toThrow(HttpException);
    });

    it('should enforce Email-level rate limiting across different client IPs (SEC-003)', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue({
        limit: 3,
        ttl: 900,
        prefix: 'account-defense',
      });

      const targetEmail = 'victim@skillup.com';

      // 3 requests from 3 distinct IPs targeting the same email
      const { context: req1 } = createMockContext(undefined, '10.0.0.1', { email: targetEmail });
      const { context: req2 } = createMockContext(undefined, '10.0.0.2', { email: targetEmail });
      const { context: req3 } = createMockContext(undefined, '10.0.0.3', { email: targetEmail });
      const { context: req4 } = createMockContext(undefined, '10.0.0.4', { email: targetEmail });

      expect(await guard.canActivate(req1)).toBe(true);
      expect(await guard.canActivate(req2)).toBe(true);
      expect(await guard.canActivate(req3)).toBe(true);

      // 4th request from another IP must be blocked because the email reached the limit (3)
      await expect(guard.canActivate(req4)).rejects.toThrow(
        expect.objectContaining({
          response: expect.objectContaining({
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            message: expect.stringContaining('targeting this account'),
          }),
        }),
      );
    });

    it('should allow requests within limit and track remaining allowance', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue({
        limit: 3,
        ttl: 60,
        prefix: 'allowance',
      });
      const { context, responseHeaders } = createMockContext();

      // Request 1
      await guard.canActivate(context);
      expect(responseHeaders['X-RateLimit-Remaining']).toBe('2');

      // Request 2
      await guard.canActivate(context);
      expect(responseHeaders['X-RateLimit-Remaining']).toBe('1');

      // Request 3
      await guard.canActivate(context);
      expect(responseHeaders['X-RateLimit-Remaining']).toBe('0');
    });

    it('should throw 429 Too Many Requests and set Retry-After when limit is exceeded', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue({
        limit: 2,
        ttl: 120,
        prefix: 'blocked',
      });
      const { context, responseHeaders } = createMockContext();

      await guard.canActivate(context); // 1
      await guard.canActivate(context); // 2

      // 3rd request exceeds limit
      await expect(guard.canActivate(context)).rejects.toThrow(HttpException);
      expect(responseHeaders['Retry-After']).toBeDefined();
    });

    it('Fail-Open Resilience: should allow traffic if Redis throws an unexpected error', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue({
        limit: 5,
        ttl: 900,
        prefix: 'fail-open',
      });
      const { context } = createMockContext();

      // Simulate Redis crash
      jest.spyOn(mockRedis, 'eval').mockRejectedValueOnce(new Error('Redis connection refused'));

      const result = await guard.canActivate(context);
      expect(result).toBe(true);
    });
  });

  describe('RegistrationProvider', () => {
    let provider: RegistrationProvider;
    let mockRedis: MockRedis;
    let mockUsersGrpc: any;
    let mockMediaService: any;

    beforeEach(() => {
      mockRedis = new MockRedis();
      mockUsersGrpc = {
        getService: () => createMockUsersServiceClient(),
      };
      mockMediaService = {
        checkFileExists: jest.fn().mockResolvedValue({
          data: { exists: true, fileSize: 1024 * 100 },
        }),
        deleteFile: jest.fn().mockResolvedValue({ success: true }),
      };

      provider = new RegistrationProvider(
        mockUsersGrpc as any,
        mockMediaService,
        mockRedis as any,
      );
      provider.onModuleInit();
    });

    it('Happy Path: should register user successfully without avatar', async () => {
      const result = await provider.register({
        username: 'newstudent',
        email: 'newstudent@skillup.com',
        password: 'Password123!',
      });
      expect(result.success).toBe(true);
      expect(result.userId).toBeDefined();
    });

    it('Happy Path: should register user with valid temp avatar and mark token as CONSUMED', async () => {
      const tempKey = 'temp_uploads/avatars/valid_avatar.jpg';
      await mockRedis.set(`upload:temp:${tempKey}`, 'PENDING', 'EX', 120);

      const result = await provider.register({
        username: 'photostudent',
        email: 'photo@skillup.com',
        password: 'Password123!',
        tempPhotoKey: tempKey,
      });

      expect(result.success).toBe(true);
      const updatedStatus = await mockRedis.get(`upload:temp:${tempKey}`);
      expect(updatedStatus).toBe('CONSUMED');
    });

    it('Replay Attack Prevention: should reject registration if avatar upload status is already CONSUMED', async () => {
      const tempKey = 'temp_uploads/avatars/consumed_avatar.jpg';
      await mockRedis.set(`upload:temp:${tempKey}`, 'CONSUMED', 'EX', 600);

      await expect(
        provider.register({
          username: 'attacker',
          email: 'attacker@skillup.com',
          password: 'Password123!',
          tempPhotoKey: tempKey,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('Storage Hygiene: should reject registration and purge avatar if file size is below 1KB or above 5MB', async () => {
      const tempKey = 'temp_uploads/avatars/tiny.jpg';
      await mockRedis.set(`upload:temp:${tempKey}`, 'PENDING', 'EX', 120);
      mockMediaService.checkFileExists.mockResolvedValueOnce({
        data: { exists: true, fileSize: 500 }, // 500 bytes < 1024
      });

      await expect(
        provider.register({
          username: 'tinystudent',
          email: 'tiny@skillup.com',
          password: 'Password123!',
          tempPhotoKey: tempKey,
        }),
      ).rejects.toThrow(BadRequestException);

      expect(mockMediaService.deleteFile).toHaveBeenCalledWith(tempKey);
    });

    it('Duplicate Conflict: should map gRPC ALREADY_EXISTS code to HTTP 409 ConflictException', async () => {
      const client = (provider as any).usersServiceClient;
      jest.spyOn(client, 'createUser').mockReturnValueOnce(
        throwError(() => ({
          code: 6,
          details: 'User with this email already exists',
        })),
      );

      await expect(
        provider.register({
          username: 'duplicate',
          email: 'existing@skillup.com',
          password: 'Password123!',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('AccountVerificationProvider', () => {
    let provider: AccountVerificationProvider;
    let mockUsersGrpc: any;
    let mockClient: any;

    beforeEach(() => {
      mockClient = createMockUsersServiceClient();
      mockUsersGrpc = {
        getService: () => mockClient,
      };
      provider = new AccountVerificationProvider(mockUsersGrpc as any);
      provider.onModuleInit();
    });

    it('Happy Path: should verify account and return tokens', async () => {
      const result = await provider.verifyAccount(
        { email: 'user@skillup.com', code: '123456' },
        { ipAddress: '127.0.0.1', userAgent: 'JestTest' },
      );
      expect(result.success).toBe(true);
      expect(result.accessToken).toBeDefined();
    });

    it('Lockout Enforcement: should map gRPC RESOURCE_EXHAUSTED to 429 Too Many Requests with Retry-After', async () => {
      jest.spyOn(mockClient, 'verifyAccount').mockReturnValueOnce(
        throwError(() => ({
          code: 8,
          details: 'Too many failed verification attempts. Please try again after 15 minutes. [Retry-After: 900]',
        })),
      );

      await expect(
        provider.verifyAccount(
          { email: 'locked@skillup.com', code: '000000' },
          { ipAddress: '127.0.0.1', userAgent: 'JestTest' },
        ),
      ).rejects.toThrow(HttpException);
    });

    it('Invalid Code: should map gRPC INVALID_ARGUMENT to 400 BadRequestException', async () => {
      jest.spyOn(mockClient, 'verifyAccount').mockReturnValueOnce(
        throwError(() => ({
          code: 3,
          details: 'Invalid verification code. You have 6 attempts remaining.',
        })),
      );

      await expect(
        provider.verifyAccount(
          { email: 'user@skillup.com', code: '999999' },
          { ipAddress: '127.0.0.1', userAgent: 'JestTest' },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('User Not Found: should map gRPC NOT_FOUND to 404 NotFoundException', async () => {
      jest.spyOn(mockClient, 'verifyAccount').mockReturnValueOnce(
        throwError(() => ({
          code: 5,
          details: 'User not found',
        })),
      );

      await expect(
        provider.verifyAccount(
          { email: 'nonexistent@skillup.com', code: '123456' },
          { ipAddress: '127.0.0.1', userAgent: 'JestTest' },
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('VerificationCodeProvider', () => {
    let provider: VerificationCodeProvider;
    let mockUsersGrpc: any;
    let mockClient: any;

    beforeEach(() => {
      mockClient = createMockUsersServiceClient();
      mockUsersGrpc = {
        getService: () => mockClient,
      };
      provider = new VerificationCodeProvider(mockUsersGrpc as any);
      provider.onModuleInit();
    });

    it('Happy Path: should resend verification code successfully', async () => {
      const result = await provider.sendVerificationCode({
        email: 'student@skillup.com',
      });
      expect(result.success).toBe(true);
    });

    it('Cooldown Active: should map gRPC RESOURCE_EXHAUSTED cooldown to 429 Too Many Requests', async () => {
      jest.spyOn(mockClient, 'sendVerificationCode').mockReturnValueOnce(
        throwError(() => ({
          code: 8,
          details: 'Please wait 45 seconds before requesting a new verification code. [Retry-After: 45]',
        })),
      );

      await expect(
        provider.sendVerificationCode({ email: 'cooldown@skillup.com' }),
      ).rejects.toThrow(HttpException);
    });
  });

  describe('LoginProvider', () => {
    let provider: LoginProvider;
    let mockUsersGrpc: any;
    let mockClient: any;

    beforeEach(() => {
      mockClient = createMockUsersServiceClient();
      mockUsersGrpc = {
        getService: () => mockClient,
      };
      provider = new LoginProvider(mockUsersGrpc as any);
      provider.onModuleInit();
    });

    it('Happy Path: should authenticate user and return tokens', async () => {
      const result = await provider.login(
        { identifier: 'student@skillup.com', password: 'Password123!' },
        { ipAddress: '127.0.0.1', userAgent: 'JestTest' },
      );
      expect(result.success).toBe(true);
      expect(result.accessToken).toBe('mock-jwt-access-token-login');
      expect(result.refreshToken).toBe('mock-refresh-token-login-hex');
      expect(result.user).toBeDefined();
      expect(result.user.email).toBe('student@skillup.com');
    });

    it('Lockout Enforcement: should map gRPC RESOURCE_EXHAUSTED to 429 Too Many Requests with Retry-After', async () => {
      jest.spyOn(mockClient, 'login').mockReturnValueOnce(
        throwError(() => ({
          code: 8,
          details: 'Too many failed login attempts. Please try again after 15 minutes. [Retry-After: 900]',
        })),
      );

      await expect(
        provider.login(
          { identifier: 'locked@skillup.com', password: 'WrongPassword123!' },
          { ipAddress: '127.0.0.1', userAgent: 'JestTest' },
        ),
      ).rejects.toThrow(HttpException);
    });

    it('Invalid Credentials: should map gRPC UNAUTHENTICATED to 401 UnauthorizedException', async () => {
      jest.spyOn(mockClient, 'login').mockReturnValueOnce(
        throwError(() => ({
          code: 16,
          details: 'Invalid credentials',
        })),
      );

      await expect(
        provider.login(
          { identifier: 'student@skillup.com', password: 'WrongPassword!' },
          { ipAddress: '127.0.0.1', userAgent: 'JestTest' },
        ),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('Unverified Account: should map gRPC FAILED_PRECONDITION to 400 BadRequestException', async () => {
      jest.spyOn(mockClient, 'login').mockReturnValueOnce(
        throwError(() => ({
          code: 9,
          details: 'Account is not verified. Please verify your email first.',
        })),
      );

      await expect(
        provider.login(
          { identifier: 'unverified@skillup.com', password: 'Password123!' },
          { ipAddress: '127.0.0.1', userAgent: 'JestTest' },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('Suspended Account: should map gRPC PERMISSION_DENIED to 403 ForbiddenException', async () => {
      jest.spyOn(mockClient, 'login').mockReturnValueOnce(
        throwError(() => ({
          code: 7,
          details: 'Account has been suspended.',
        })),
      );

      await expect(
        provider.login(
          { identifier: 'suspended@skillup.com', password: 'Password123!' },
          { ipAddress: '127.0.0.1', userAgent: 'JestTest' },
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
