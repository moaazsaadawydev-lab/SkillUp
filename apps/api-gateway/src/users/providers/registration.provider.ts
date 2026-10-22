import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import { randomUUID } from 'crypto';
import {
  USERS_SERVICE_NAME,
  UsersServiceClient,
  CreateUserRequest,
  CreateUserResponse,
} from '@skillup/shared/interfaces';
import { RedisService } from '@skillup/shared/redis';
import { MediaService } from '../../media/media.service';
import { RegisterRequestDto } from '../dto/register-request.dto';

@Injectable()
export class RegistrationProvider implements OnModuleInit {
  private readonly logger = new Logger(RegistrationProvider.name);
  private usersServiceClient: UsersServiceClient;

  constructor(
    @Inject(USERS_SERVICE_NAME) private readonly usersGrpcClient: ClientGrpc,
    private readonly mediaService: MediaService,
    private readonly redisService: RedisService,
  ) {}

  onModuleInit() {
    this.usersServiceClient =
      this.usersGrpcClient.getService<UsersServiceClient>(USERS_SERVICE_NAME);
  }

  /**
   * Handle user registration:
   * 1. Single-use Presigned URL validation via Redis (PENDING status with 120s TTL).
   * 2. Content-length validation in MinIO (strictly 1KB to 5MB).
   * 3. Invoke UsersService gRPC CreateUser.
   * 4. Transition Redis upload state to CONSUMED.
   * 5. Map gRPC errors to standard HTTP exceptions.
   */
  async register(dto: RegisterRequestDto): Promise<CreateUserResponse> {
    const userId = randomUUID();
    const tempKey = dto.tempPhotoKey || dto.temp_photo_key;
    let targetKey: string | undefined;

    // 1. Verify single-use Presigned URL token & Content-Length in storage
    if (tempKey) {
      // A. Verify single-use status in Redis
      const uploadStatus = await this.redisService.get(`upload:temp:${tempKey}`);
      if (!uploadStatus) {
        throw new BadRequestException(
          'Avatar upload URL has expired (valid for 2 minutes) or is invalid. Please upload your avatar again.',
        );
      }

      if (uploadStatus === 'CONSUMED') {
        throw new ConflictException(
          'This avatar upload has already been consumed by another registration. Please upload a fresh photo.',
        );
      }

      if (uploadStatus !== 'PENDING') {
        throw new BadRequestException('Invalid upload status for avatar photo.');
      }

      // B. Verify actual file existence & strict content-length (1KB to 5MB)
      try {
        const fileCheck = await this.mediaService.checkFileExists(tempKey);
        if (!fileCheck.data.exists) {
          throw new BadRequestException(
            `Avatar file at "${tempKey}" does not exist in storage or has expired. Please upload your avatar again.`,
          );
        }

        const size = fileCheck.data.fileSize || 0;
        const MIN_SIZE = 1024; // 1 KB
        const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

        if (size < MIN_SIZE || size > MAX_SIZE) {
          this.logger.warn(
            `Rejected registration: avatar size (${size} bytes) is outside allowed range [1KB, 5MB] for key "${tempKey}"`,
          );
          // Immediately purge offending file from MinIO and Redis
          await this.mediaService.deleteFile(tempKey).catch(() => null);
          await this.redisService.del(`upload:temp:${tempKey}`).catch(() => null);

          throw new BadRequestException(
            `Avatar file size must be between 1KB and 5MB. Uploaded size: ${Math.round(size / 1024)} KB.`,
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
        throw new BadRequestException('Failed to verify avatar file in storage.');
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
          cropX: dto.cropX ?? dto.crop_x,
          cropY: dto.cropY ?? dto.crop_y,
          cropWidth: dto.cropWidth ?? dto.crop_width,
          cropHeight: dto.cropHeight ?? dto.crop_height,
          crop_x: dto.cropX ?? dto.crop_x,
          crop_y: dto.cropY ?? dto.crop_y,
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

      // 4. Mark single-use upload token as CONSUMED in Redis for 10 minutes (prevents replay attacks)
      if (tempKey) {
        await this.redisService.setWithTtl(`upload:temp:${tempKey}`, 'CONSUMED', 600);
        this.logger.log(`Marked temp avatar key as CONSUMED in Redis: "${tempKey}"`);
      }

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
