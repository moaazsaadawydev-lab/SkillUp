import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { AuthService } from './auth.service';
import { RegisterRequestDto } from './dto/register-request.dto';
import { VerifyAccountDto } from './dto/verify-account.dto';
import { SendVerificationCodeDto } from './dto/send-verification-code.dto';
import { RateLimit } from '../common';

@Controller('users/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * POST /api/v1/users/auth/register
   * Pure JSON registration endpoint supporting direct-to-storage avatar ingestion via tempPhotoKey.
   * Rate Limited: Max 5 registration attempts per 15 minutes per IP address.
   */
  @Post('register')
  @RateLimit({ limit: 5, ttl: 900, prefix: 'register' })
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() dto: RegisterRequestDto) {
    return this.authService.register(dto);
  }

  /**
   * POST /api/v1/users/auth/verify-account
   * Verifies 6-digit OTP, activates user account, and issues auto-login dual-tokens.
   * Rate Limited: Max 15 verification attempts per 15 minutes per IP address.
   */
  @Post('verify-account')
  @RateLimit({ limit: 15, ttl: 900, prefix: 'verify-account' })
  @HttpCode(HttpStatus.OK)
  async verifyAccount(
    @Body() dto: VerifyAccountDto,
    @Req() req: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ipAddress =
      req.headers['x-forwarded-for']?.toString().split(',')[0].trim() ||
      req.ip ||
      req.socket?.remoteAddress ||
      '127.0.0.1';
    const userAgent = req.headers['user-agent'] || 'Unknown-Device';

    try {
      const result = await this.authService.verifyAccount(dto, {
        ipAddress,
        userAgent,
      });

      // Attach secure HttpOnly refresh token cookie on successful verification
      if (result.refreshToken) {
        res.cookie('refresh_token', result.refreshToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          path: '/api/v1/users/auth',
          maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        });
      }

      return {
        success: true,
        message: result.message,
        data: {
          accessToken: result.accessToken,
          user: result.user,
        },
      };
    } catch (error: any) {
      if (
        error instanceof HttpException &&
        error.getStatus() === HttpStatus.TOO_MANY_REQUESTS
      ) {
        const responseBody = error.getResponse() as any;
        if (responseBody?.retryAfter) {
          res.setHeader('Retry-After', responseBody.retryAfter.toString());
        }
      }
      throw error;
    }
  }

  /**
   * POST /api/v1/users/auth/send-verification-code
   * Re-issues a fresh 6-digit OTP code subject to a 60-second cooldown timer.
   * Rate Limited: Max 5 code request attempts per 15 minutes per IP address.
   */
  @Post('send-verification-code')
  @RateLimit({ limit: 5, ttl: 900, prefix: 'send-otp' })
  @HttpCode(HttpStatus.OK)
  async sendVerificationCode(
    @Body() dto: SendVerificationCodeDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      return await this.authService.sendVerificationCode(dto);
    } catch (error: any) {
      if (
        error instanceof HttpException &&
        error.getStatus() === HttpStatus.TOO_MANY_REQUESTS
      ) {
        const responseBody = error.getResponse() as any;
        if (responseBody?.retryAfter) {
          res.setHeader('Retry-After', responseBody.retryAfter.toString());
        }
      }
      throw error;
    }
  }
}
