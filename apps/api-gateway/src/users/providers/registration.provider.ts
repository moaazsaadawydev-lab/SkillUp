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
import { MediaService } from '../../media/media.service';
import { RegisterRequestDto } from '../dto/register-request.dto';

@Injectable()
export class RegistrationProvider implements OnModuleInit {
  private readonly logger = new Logger(RegistrationProvider.name);
  private usersServiceClient: UsersServiceClient;

  constructor(
    @Inject(USERS_SERVICE_NAME) private readonly usersGrpcClient: ClientGrpc,
    private readonly mediaService: MediaService,
  ) {}

  onModuleInit() {
    this.usersServiceClient =
      this.usersGrpcClient.getService<UsersServiceClient>(USERS_SERVICE_NAME);
  }

  /**
   * Handle user registration:
   * 1. If tempPhotoKey is provided, verify file existence via MediaService and compute destination path.
   * 2. Build transformations object if crop coordinates or rotation were specified.
   * 3. Invoke UsersService gRPC CreateUser.
   * 4. Map gRPC errors to standard HTTP exceptions.
   */
  async register(dto: RegisterRequestDto): Promise<CreateUserResponse> {
    const userId = randomUUID();
    const tempKey = dto.tempPhotoKey || dto.temp_photo_key;
    let targetKey: string | undefined;

    // 1. Verify temp avatar file existence in storage if provided
    if (tempKey) {
      try {
        const fileCheck = await this.mediaService.checkFileExists(tempKey);
        if (!fileCheck.data.exists) {
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
