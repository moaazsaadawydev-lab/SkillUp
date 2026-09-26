import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  InternalServerErrorException,
  Logger,
  OnModuleInit,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
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
} from '@skillup/shared/interfaces';
import { RegisterRequestDto } from './dto/register-request.dto';
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
}
