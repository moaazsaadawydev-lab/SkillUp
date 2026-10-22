import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { RegisterRequestDto } from '../../src/users/dto/register-request.dto';
import { VerifyAccountDto } from '../../src/users/dto/verify-account.dto';
import { SendVerificationCodeDto } from '../../src/users/dto/send-verification-code.dto';
import { GetPresignedUrlDto } from '../../src/media/dto/get-presigned-url.dto';

describe('Unit Tests: DTO Validation & Input Hardening', () => {
  describe('RegisterRequestDto', () => {
    it('Happy Path: should validate successfully with clean, valid registration data', async () => {
      const dto = plainToInstance(RegisterRequestDto, {
        username: 'johndoe',
        email: 'john.doe@example.com',
        password: 'Password123!',
        birthDate: '2000-01-01',
      });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('Happy Path: should validate successfully with optional tempPhotoKey and crop coordinates', async () => {
      const dto = plainToInstance(RegisterRequestDto, {
        username: 'sarah_connor',
        email: 'sarah@resistance.org',
        password: 'SecurePass987!',
        tempPhotoKey: 'temp_uploads/avatars/uuid_photo.jpg',
        cropX: 0,
        cropY: 10,
        cropWidth: 200,
        cropHeight: 200,
      });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('Edge Case: should fail validation if required fields (username, email, password) are missing', async () => {
      const dto = plainToInstance(RegisterRequestDto, {});
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThanOrEqual(3);
      const fieldsWithErrors = errors.map((e) => e.property);
      expect(fieldsWithErrors).toContain('username');
      expect(fieldsWithErrors).toContain('email');
      expect(fieldsWithErrors).toContain('password');
    });

    it('Edge Case: should fail validation if username is too short (< 3) or too long (> 50)', async () => {
      const shortDto = plainToInstance(RegisterRequestDto, {
        username: 'ab',
        email: 'valid@example.com',
        password: 'Password123!',
      });
      const shortErrors = await validate(shortDto);
      expect(shortErrors.some((e) => e.property === 'username')).toBe(true);

      const longDto = plainToInstance(RegisterRequestDto, {
        username: 'a'.repeat(51),
        email: 'valid@example.com',
        password: 'Password123!',
      });
      const longErrors = await validate(longDto);
      expect(longErrors.some((e) => e.property === 'username')).toBe(true);
    });

    it('Edge Case: should fail validation if email is invalid', async () => {
      const invalidEmails = [
        'plainaddress',
        '#@%^%#$@#$@#.com',
        '@example.com',
        'Joe Smith <email@example.com>',
        'email.example.com',
        'email@example@example.com',
      ];
      for (const email of invalidEmails) {
        const dto = plainToInstance(RegisterRequestDto, {
          username: 'validuser',
          email,
          password: 'Password123!',
        });
        const errors = await validate(dto);
        expect(errors.some((e) => e.property === 'email')).toBe(true);
      }
    });

    it('Edge Case: should fail validation if password is shorter than 8 characters', async () => {
      const dto = plainToInstance(RegisterRequestDto, {
        username: 'validuser',
        email: 'valid@example.com',
        password: 'Pass1',
      });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'password')).toBe(true);
    });

    it('Security / XSS: should reject path traversal and malicious regex injection in tempPhotoKey', async () => {
      const maliciousKeys = [
        '../../etc/passwd',
        'temp_uploads/avatars/../../../secret.txt',
        'temp_uploads/avatars/<script>alert(1)</script>',
        'uploads/avatars/valid.jpg', // missing temp_uploads
        'temp_uploads/avatars/file;rm -rf /',
        'temp_uploads/avatars/photo.jpg?token=steal',
      ];
      for (const tempPhotoKey of maliciousKeys) {
        const dto = plainToInstance(RegisterRequestDto, {
          username: 'validuser',
          email: 'valid@example.com',
          password: 'Password123!',
          tempPhotoKey,
        });
        const errors = await validate(dto);
        expect(errors.some((e) => e.property === 'tempPhotoKey')).toBe(true);
      }
    });

    it('Edge Case: should reject negative or non-integer crop coordinates', async () => {
      const dtoNegative = plainToInstance(RegisterRequestDto, {
        username: 'validuser',
        email: 'valid@example.com',
        password: 'Password123!',
        cropX: -10,
        cropY: -5,
      });
      const errorsNegative = await validate(dtoNegative);
      expect(errorsNegative.some((e) => e.property === 'cropX')).toBe(true);
      expect(errorsNegative.some((e) => e.property === 'cropY')).toBe(true);

      const dtoFloat = plainToInstance(RegisterRequestDto, {
        username: 'validuser',
        email: 'valid@example.com',
        password: 'Password123!',
        cropWidth: 50.75,
      });
      const errorsFloat = await validate(dtoFloat);
      expect(errorsFloat.some((e) => e.property === 'cropWidth')).toBe(true);
    });
  });

  describe('VerifyAccountDto', () => {
    it('Happy Path: should validate clean 6-digit verification code and email', async () => {
      const dto = plainToInstance(VerifyAccountDto, {
        email: 'test@skillup.com',
        code: '123456',
      });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('Security / Edge Case: should reject non-numeric, alphanumeric, and script-injected verification codes', async () => {
      const invalidCodes = [
        '12345',      // 5 digits
        '1234567',    // 7 digits
        'abcdef',     // letters
        '12345a',     // alphanumeric
        '<script>',   // XSS string
        '12 456',     // spaces
        '-12345',     // negative
      ];
      for (const code of invalidCodes) {
        const dto = plainToInstance(VerifyAccountDto, {
          email: 'test@skillup.com',
          code,
        });
        const errors = await validate(dto);
        expect(errors.some((e) => e.property === 'code')).toBe(true);
      }
    });
  });

  describe('SendVerificationCodeDto', () => {
    it('Happy Path: should validate valid email', async () => {
      const dto = plainToInstance(SendVerificationCodeDto, {
        email: 'student@university.edu',
      });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('Security / Edge Case: should reject missing or XSS-laden emails', async () => {
      const maliciousEmails = [
        '<script>alert("xss")</script>@domain.com',
        '"><img src=x onerror=alert(1)>',
        '',
      ];
      for (const email of maliciousEmails) {
        const dto = plainToInstance(SendVerificationCodeDto, { email });
        const errors = await validate(dto);
        expect(errors.some((e) => e.property === 'email')).toBe(true);
      }
    });
  });

  describe('GetPresignedUrlDto', () => {
    it('Happy Path: should validate valid image upload request', async () => {
      const dto = plainToInstance(GetPresignedUrlDto, {
        filename: 'avatar.png',
        contentType: 'image/png',
        fileSize: 1024 * 500, // 500 KB
        category: 'AVATAR',
      });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('Security: should strictly enforce image MIME whitelist and reject executable or dangerous MIME types', async () => {
      const dangerousMimes = [
        'application/x-sh',
        'application/x-msdos-program',
        'application/javascript',
        'text/html',
        'image/svg+xml', // SVG can carry XSS payloads
        'image/gif',
        'application/pdf',
      ];
      for (const contentType of dangerousMimes) {
        const dto = plainToInstance(GetPresignedUrlDto, {
          filename: 'test.bin',
          contentType,
          fileSize: 1024 * 100,
        });
        const errors = await validate(dto);
        expect(errors.some((e) => e.property === 'contentType')).toBe(true);
      }
    });

    it('Edge Case: should reject file size of 0 or exceeding 5MB limit', async () => {
      const dtoZero = plainToInstance(GetPresignedUrlDto, {
        filename: 'photo.jpg',
        contentType: 'image/jpeg',
        fileSize: 0,
      });
      const errorsZero = await validate(dtoZero);
      expect(errorsZero.some((e) => e.property === 'fileSize')).toBe(true);

      const dtoOver5MB = plainToInstance(GetPresignedUrlDto, {
        filename: 'photo.jpg',
        contentType: 'image/jpeg',
        fileSize: 5 * 1024 * 1024 + 1, // 5MB + 1 byte
      });
      const errorsOver = await validate(dtoOver5MB);
      expect(errorsOver.some((e) => e.property === 'fileSize')).toBe(true);
    });
  });
});
