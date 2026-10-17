import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  OnModuleInit,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import { randomUUID } from 'crypto';
import {
  USERS_SERVICE_NAME,
  UsersServiceClient,
  MEDIA_SERVICE_NAME,
  MediaServiceClient,
  CreateUserRequest,
  CreateUserResponse,
  VerifyAccountResponse,
} from '@skillup/shared/interfaces';
import { RegisterRequestDto } from './dto/register-request.dto';
import { VerifyAccountDto } from './dto/verify-account.dto';
import { SendVerificationCodeDto } from './dto/send-verification-code.dto';

@Controller('users/auth')
export class AuthController implements OnModuleInit {
  private readonly logger = new Logger(AuthController.name);
  private usersServiceClient: UsersServiceClient;
  private mediaServiceClient: MediaServiceClient;

  constructor(
    @Inject(USERS_SERVICE_NAME) private readonly usersGrpcClient: ClientGrpc,
    @Inject(MEDIA_SERVICE_NAME) private readonly mediaGrpcClient: ClientGrpc,
  ) {}

  onModuleInit() {
    this.usersServiceClient =
      this.usersGrpcClient.getService<UsersServiceClient>(USERS_SERVICE_NAME);
    this.mediaServiceClient =
      this.mediaGrpcClient.getService<MediaServiceClient>(MEDIA_SERVICE_NAME);
  }

  /**
   * POST /api/v1/users/auth/register
   * Pure JSON registration endpoint supporting direct-to-storage avatar ingestion via tempPhotoKey.
   */
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(
    @Body() dto: RegisterRequestDto,
  ): Promise<CreateUserResponse> {
    const userId = randomUUID();
    const tempKey = dto.tempPhotoKey || dto.temp_photo_key;
    let targetKey: string | undefined;

    // 1. If tempPhotoKey is provided, verify file existence & configure destination path
    if (tempKey) {
      try {
        const fileCheck = await firstValueFrom(
          this.mediaServiceClient.checkFileExists({ fileKey: tempKey }),
        );

        if (!fileCheck.exists) {
          throw new BadRequestException(
            `Avatar file at "${tempKey}" does not exist in storage or has expired. Please upload your avatar again.`,
          );
        }
      } catch (checkError: any) {
        if (checkError instanceof HttpException) {
          throw checkError;
        }
        this.logger.warn(
          `Could not verify temp avatar existence for ${tempKey}:`,
          checkError,
        );
      }

      // Pre-determined destination path in main avatars directory: avatars/{userId}/avatar.webp
      targetKey = `avatars/${userId}/avatar.webp`;
      this.logger.debug(
        `Determined avatar storage paths: temp=${tempKey}, target=${targetKey}`,
      );
    }

    // 2. Build transformations object if avatar was uploaded
    const transformations = tempKey
      ? {
          cropX: dto.cropX ?? dto.crop_x ?? 0,
          cropY: dto.cropY ?? dto.crop_y ?? 0,
          cropWidth: dto.cropWidth ?? dto.crop_width,
          cropHeight: dto.cropHeight ?? dto.crop_height,
          crop_x: dto.cropX ?? dto.crop_x ?? 0,
          crop_y: dto.cropY ?? dto.crop_y ?? 0,
          crop_width: dto.cropWidth ?? dto.crop_width,
          crop_height: dto.cropHeight ?? dto.crop_height,
          rotate: dto.rotate ?? 0,
          scale: dto.scale ?? dto.zoom ?? 1,
          zoom: dto.scale ?? dto.zoom ?? 1,
        }
      : undefined;

    // 3. Invoke users-service over gRPC
    const createPayload: CreateUserRequest = {
      id: userId,
      username: dto.username,
      email: dto.email,
      password: dto.password,
      birthDate: dto.birthDate || dto.birth_date,
      birth_date: dto.birthDate || dto.birth_date,
      profilePhoto: targetKey,
      profile_photo: targetKey,
      tempPhotoKey: tempKey,
      temp_photo_key: tempKey,
      transformations,
    };

    try {
      const response = await firstValueFrom(
        this.usersServiceClient.createUser(createPayload),
      );

      return {
        success: response.success,
        message: response.message,
        userId: response.userId,
      };
    } catch (grpcError: any) {
      this.logger.error('gRPC CreateUser call failed:', grpcError);

      // gRPC status code 6 is ALREADY_EXISTS
      if (
        grpcError.code === 6 ||
        grpcError.details?.toLowerCase().includes('already exists') ||
        grpcError.message?.toLowerCase().includes('already exists')
      ) {
        throw new ConflictException(
          grpcError.details || grpcError.message || 'User already exists',
        );
      }

      throw new InternalServerErrorException(
        grpcError.details ||
          grpcError.message ||
          'Internal server error during registration',
      );
    }
  }

  /**
   * POST /api/v1/users/auth/verify-account
   * Verifies 6-digit OTP, activates user account, and issues auto-login dual-tokens.
   */
  @Post('verify-account')
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
      const response: VerifyAccountResponse = await firstValueFrom(
        this.usersServiceClient.verifyAccount({
          email: dto.email,
          code: dto.code,
          ipAddress,
          ip_address: ipAddress,
          userAgent,
          user_agent: userAgent,
        }),
      );

      // Set HttpOnly refresh token cookie on successful verification
      const refreshToken =
        response.data?.refreshToken || response.data?.refresh_token;
      if (refreshToken) {
        res.cookie('refresh_token', refreshToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          path: '/api/v1/users/auth',
          maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        });
      }

      return {
        success: true,
        message: 'Account verified and logged in successfully',
        data: {
          accessToken:
            response.data?.accessToken || response.data?.access_token,
          user: response.data?.user,
        },
      };
    } catch (grpcError: any) {
      this.logger.error('gRPC VerifyAccount call failed:', grpcError);

      const rawErrorMessage =
        grpcError.details || grpcError.message || 'Verification failed';

      // 429 Too Many Requests: Rate limiting / Brute-force lockout
      if (
        grpcError.code === 8 || // RESOURCE_EXHAUSTED
        rawErrorMessage.toLowerCase().includes('too many') ||
        rawErrorMessage.toLowerCase().includes('15 minutes')
      ) {
        const ttlMatch = rawErrorMessage.match(/\[Retry-After:\s*(\d+)\]/);
        const retryAfterSeconds = ttlMatch ? parseInt(ttlMatch[1], 10) : 900;
        const cleanMessage = rawErrorMessage
          .replace(/\s*\[Retry-After:\s*\d+\]/, '')
          .trim();

        res.setHeader('Retry-After', retryAfterSeconds.toString());
        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            message: cleanMessage,
            error: 'Too Many Requests',
            retryAfter: retryAfterSeconds,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      // 400 Bad Request for invalid OTP, remaining attempts, expired, already active
      if (
        grpcError.code === 3 || // INVALID_ARGUMENT
        grpcError.code === 9 || // FAILED_PRECONDITION
        rawErrorMessage.toLowerCase().includes('invalid') ||
        rawErrorMessage.toLowerCase().includes('attempts remaining') ||
        rawErrorMessage.toLowerCase().includes('expired') ||
        rawErrorMessage.toLowerCase().includes('already active')
      ) {
        throw new BadRequestException(rawErrorMessage);
      }

      // 404 Not Found: User record not found
      if (
        grpcError.code === 5 || // NOT_FOUND
        rawErrorMessage.toLowerCase().includes('not found')
      ) {
        throw new NotFoundException(rawErrorMessage);
      }

      throw new InternalServerErrorException(rawErrorMessage);
    }
  }

  /**
   * POST /api/v1/users/auth/send-verification-code
   * Re-issues a fresh 6-digit OTP code subject to a 60-second cooldown timer.
   */
  @Post('send-verification-code')
  @HttpCode(HttpStatus.OK)
  async sendVerificationCode(
    @Body() dto: SendVerificationCodeDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      const response = await firstValueFrom(
        this.usersServiceClient.sendVerificationCode({
          email: dto.email,
        }),
      );

      return {
        success: response.success,
        message: response.message,
      };
    } catch (grpcError: any) {
      this.logger.error('gRPC SendVerificationCode call failed:', grpcError);

      const rawErrorMessage =
        grpcError.details ||
        grpcError.message ||
        'Failed to send verification code';

      // 429 Too Many Requests: 60-second cooldown active
      if (
        grpcError.code === 8 || // RESOURCE_EXHAUSTED
        rawErrorMessage.toLowerCase().includes('please wait') ||
        rawErrorMessage.toLowerCase().includes('too many') ||
        rawErrorMessage.toLowerCase().includes('locked')
      ) {
        const ttlMatch = rawErrorMessage.match(/\[Retry-After:\s*(\d+)\]/);
        const retryAfterSeconds = ttlMatch ? parseInt(ttlMatch[1], 10) : 60;
        const cleanMessage = rawErrorMessage
          .replace(/\s*\[Retry-After:\s*\d+\]/, '')
          .trim();

        res.setHeader('Retry-After', retryAfterSeconds.toString());
        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            message: cleanMessage,
            error: 'Too Many Requests',
            retryAfter: retryAfterSeconds,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      // 400 Bad Request: Account already active / preconditions
      if (
        grpcError.code === 3 || // INVALID_ARGUMENT
        grpcError.code === 9 || // FAILED_PRECONDITION
        rawErrorMessage.toLowerCase().includes('already active')
      ) {
        throw new BadRequestException(rawErrorMessage);
      }

      // 403 Forbidden: Account blocked or deleted
      if (
        grpcError.code === 7 || // PERMISSION_DENIED
        rawErrorMessage.toLowerCase().includes('not eligible')
      ) {
        throw new ForbiddenException(rawErrorMessage);
      }

      // 404 Not Found: User not found
      if (
        grpcError.code === 5 || // NOT_FOUND
        rawErrorMessage.toLowerCase().includes('not found')
      ) {
        throw new NotFoundException(rawErrorMessage);
      }

      throw new InternalServerErrorException(rawErrorMessage);
    }
  }
}
