import {
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import {
  MEDIA_SERVICE_NAME,
  MediaServiceClient,
  UploadCategory,
} from '@skillup/shared/interfaces';
import { GetPresignedUrlDto } from '../dto/get-presigned-url.dto';

@Injectable()
export class UploadUrlProvider implements OnModuleInit {
  private readonly logger = new Logger(UploadUrlProvider.name);
  private mediaServiceClient: MediaServiceClient;

  constructor(
    @Inject(MEDIA_SERVICE_NAME) private readonly grpcClient: ClientGrpc,
  ) {}

  onModuleInit() {
    this.mediaServiceClient =
      this.grpcClient.getService<MediaServiceClient>(MEDIA_SERVICE_NAME);
  }

  /**
   * Request presigned upload URL specifically for avatar uploads
   */
  async getAvatarUploadUrl(dto: GetPresignedUrlDto) {
    return this.generateUploadUrl(dto, UploadCategory.AVATAR);
  }

  /**
   * Request presigned upload URL for general uploads by category
   */
  async getGeneralUploadUrl(dto: GetPresignedUrlDto) {
    const category = dto.category || UploadCategory.AVATAR;
    return this.generateUploadUrl(dto, category);
  }

  /**
   * Internal helper to call MediaService gRPC GetPresignedUploadUrl
   */
  async generateUploadUrl(
    dto: GetPresignedUrlDto,
    category: UploadCategory | string,
  ) {
    try {
      const response = await firstValueFrom(
        this.mediaServiceClient.getPresignedUploadUrl({
          filename: dto.filename,
          contentType: dto.contentType,
          fileSize: dto.fileSize,
          category,
        }),
      );

      if (!response.success) {
        throw new BadRequestException(
          response.message || 'Failed to generate presigned upload URL',
        );
      }

      return {
        success: true,
        message:
          response.message || 'Presigned upload URL generated successfully',
        data: {
          uploadUrl: response.uploadUrl || response.upload_url,
          fileKey: response.fileKey || response.file_key,
          expiresIn: response.expiresIn || response.expires_in,
        },
      };
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error('gRPC GetPresignedUploadUrl failed:', error);
      throw new InternalServerErrorException(
        error.details || error.message || 'Media service communication error',
      );
    }
  }
}
