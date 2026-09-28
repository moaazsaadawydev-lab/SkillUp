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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { ClientGrpc } from '@nestjs/microservices';
import 'multer';
import { firstValueFrom } from 'rxjs';
import { randomUUID } from 'crypto';
import {
  USERS_SERVICE_NAME,
  UsersServiceClient,
  CreateUserRequest,
  CreateUserResponse,
  VerifyAccountResponse,
} from '@skillup/shared/interfaces';
import { RegisterRequestDto } from './dto/register-request.dto';
import { VerifyAccountDto } from './dto/verify-account.dto';
import { SendVerificationCodeDto } from './dto/send-verification-code.dto';
import { MinioService } from '../storage/minio.service';

@Controller('users/auth')
export class AuthController implements OnModuleInit {
  private readonly logger = new Logger(AuthController.name);
  private usersServiceClient: UsersServiceClient;

  constructor(
    @Inject(USERS_SERVICE_NAME) private readonly grpcClient: ClientGrpc,
    private readonly minioService: MinioService,
  ) {}

  onModuleInit() {
    this.usersServiceClient =
      this.grpcClient.getService<UsersServiceClient>(USERS_SERVICE_NAME);
  }

  /**
   * POST /api/v1/users/auth/register
   * Handles user registration with multipart/form-data support for profile avatar.
   */
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileInterceptor('avatar', {
      limits: {
        fileSize: 5 * 1024 * 1024, // 5MB limit
      },
    }),
  )
  async register(
    @Body() dto: RegisterRequestDto,
    @UploadedFile() avatar?: Express.Multer.File,
  ): Promise<CreateUserResponse> {
    const userId = randomUUID();
    let tempKey: string | undefined;
    let targetKey: string | undefined;

    const cropX = dto.crop_x ?? dto.cropX;
    const cropY = dto.crop_y ?? dto.cropY;
    const cropWidth = dto.crop_width ?? dto.cropWidth;
    const cropHeight = dto.crop_height ?? dto.cropHeight;
    const rotate = dto.rotate ?? 0;
    const scale = dto.scale ?? dto.zoom ?? 1;

    // 1. Strict validation: If avatar is uploaded, all crop dimensions are mandatory
    if (avatar) {
      if (
        cropX === undefined ||
        cropX === null ||
        cropY === undefined ||
        cropY === null ||
        cropWidth === undefined ||
        cropWidth === null ||
        cropHeight === undefined ||
        cropHeight === null ||
        isNaN(cropX) ||
        isNaN(cropY) ||
        isNaN(cropWidth) ||
        isNaN(cropHeight) ||
        cropX < 0 ||
        cropY < 0 ||
        cropWidth <= 0 ||
        cropHeight <= 0
      ) {
        throw new BadRequestException(
          'Crop metadata (crop_x, crop_y, crop_width, crop_height) is required when an avatar image is uploaded',
        );
      }

      // Store raw buffer in MinIO under temporary key
      try {
        const uploadResult = await this.minioService.uploadTempFile(avatar);
        tempKey = uploadResult.tempKey;

        // Pre-determined destination path (Deterministic Storage Pattern)
        targetKey = `profile_photos/${userId}/avatar.webp`;

        this.logger.debug(
          `Determined avatar storage paths: temp=${tempKey}, target=${targetKey}`,
        );
      } catch (uploadError) {
        this.logger.error('Failed to upload avatar to MinIO:', uploadError);
        throw new InternalServerErrorException(
          'Failed to upload avatar image. Please try again.',
        );
      }
    }

    const transformations = avatar
      ? {
          cropX,
          cropY,
          cropWidth,
          cropHeight,
          crop_x: cropX,
          crop_y: cropY,
          crop_width: cropWidth,
          crop_height: cropHeight,
          rotate,
          scale,
          zoom: scale,
        }
      : undefined;

    // 2. Invoke users-service over gRPC
    const createPayload: CreateUserRequest = {
      id: userId,
      username: dto.username,
      email: dto.email,
      password: dto.password,
      birthDate: dto.birth_date || dto.birthDate,
      profilePhoto: targetKey,
      tempPhotoKey: tempKey,
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

    const userAgent = req.headers['user-agent'] || 'unknown';

    try {
      const response = await firstValueFrom(
        this.usersServiceClient.verifyAccount({
          email: dto.email,
          code: dto.code,
          ipAddress,
          userAgent,
        }),
      );

      const refreshToken =
        response.data?.refreshToken || response.data?.refresh_token;

      if (refreshToken) {
        res.cookie('refreshToken', refreshToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          path: '/api/v1/users/auth', // Scoped to auth endpoints (refresh, logout)
          maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds
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
        rawErrorMessage.toLowerCase().includes('already active') ||
        rawErrorMessage.toLowerCase().includes('expired') ||
        rawErrorMessage.toLowerCase().includes('invalid') ||
        rawErrorMessage.toLowerCase().includes('attempts remaining')
      ) {
        throw new BadRequestException(rawErrorMessage);
      }

      if (
        grpcError.code === 5 ||
        rawErrorMessage.toLowerCase().includes('not found')
      ) {
        throw new NotFoundException(rawErrorMessage);
      }

      throw new InternalServerErrorException(rawErrorMessage);
    }
  }

  /**
   * POST /api/v1/users/auth/send-verification-code
   * Resends a fresh 6-digit OTP verification code with a 60-second cooldown.
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
