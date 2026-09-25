import {
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

    // 1. If photo is uploaded, store raw buffer in MinIO under temporary key
    if (avatar) {
      try {
        const uploadResult = await this.minioService.uploadTempFile(avatar);
        tempKey = uploadResult.tempKey;

        // Pre-determined destination path (Deterministic Storage Pattern)
        const timestamp = Date.now();
        targetKey = `profiles/${userId}/avatar_${timestamp}.webp`;

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

    // 2. Invoke users-service over gRPC
    const createPayload: CreateUserRequest = {
      id: userId,
      username: dto.username,
      email: dto.email,
      password: dto.password,
      birthDate: dto.birth_date || dto.birthDate,
      profilePhoto: targetKey,
      tempPhotoKey: tempKey,
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
