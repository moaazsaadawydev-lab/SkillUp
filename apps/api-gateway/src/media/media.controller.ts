import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  OnModuleInit,
  Post,
  Query,
} from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import {
  MEDIA_SERVICE_NAME,
  MediaServiceClient,
  UploadCategory,
} from '@skillup/shared/interfaces';
import { GetPresignedUrlDto } from './dto/get-presigned-url.dto';

@Controller('media')
export class MediaController implements OnModuleInit {
  private readonly logger = new Logger(MediaController.name);
  private mediaServiceClient: MediaServiceClient;

  constructor(
    @Inject(MEDIA_SERVICE_NAME) private readonly grpcClient: ClientGrpc,
  ) {}

  onModuleInit() {
    this.mediaServiceClient =
      this.grpcClient.getService<MediaServiceClient>(MEDIA_SERVICE_NAME);
  }

  /**
   * POST /api/v1/media/avatar/upload-url
   * Specific endpoint for requesting presigned upload URL for user avatars
   */
  @Post('avatar/upload-url')
  @HttpCode(HttpStatus.OK)
  async getAvatarUploadUrl(@Body() dto: GetPresignedUrlDto) {
    return this.generateUploadUrl(dto, UploadCategory.AVATAR);
  }

  /**
   * POST /api/v1/media/upload-url
   * General endpoint for requesting presigned upload URLs by category
   */
  @Post('upload-url')
  @HttpCode(HttpStatus.OK)
  async getGeneralUploadUrl(@Body() dto: GetPresignedUrlDto) {
    const category = dto.category || UploadCategory.AVATAR;
    return this.generateUploadUrl(dto, category);
  }

  /**
   * GET /api/v1/media/file-url?key=...
   * Retrieves access URL for a stored object
   */
  @Get('file-url')
  async getFileUrl(@Query('key') fileKey: string) {
    if (!fileKey) {
      throw new BadRequestException('Query parameter "key" is required');
    }

    try {
      const response = await firstValueFrom(
        this.mediaServiceClient.getFileUrl({ fileKey }),
      );

      return {
        success: true,
        data: {
          url: response.url,
          expiresIn: response.expiresIn || response.expires_in,
        },
      };
    } catch (error: any) {
      this.logger.error(`gRPC GetFileUrl failed for key="${fileKey}":`, error);
      throw new InternalServerErrorException(
        error.details || error.message || 'Failed to retrieve file URL',
      );
    }
  }

  /**
   * GET /api/v1/media/check-file?key=...
   * Verifies if a file exists in object storage
   */
  @Get('check-file')
  async checkFileExists(@Query('key') fileKey: string) {
    if (!fileKey) {
      throw new BadRequestException('Query parameter "key" is required');
    }

    try {
      const response = await firstValueFrom(
        this.mediaServiceClient.checkFileExists({ fileKey }),
      );

      if (!response.exists) {
        throw new NotFoundException(`File "${fileKey}" not found`);
      }

      return {
        success: true,
        data: {
          exists: response.exists,
          fileSize: response.fileSize ?? response.file_size,
          contentType: response.contentType || response.content_type,
        },
      };
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error(`gRPC CheckFileExists failed for key="${fileKey}":`, error);
      throw new InternalServerErrorException(
        error.details || error.message || 'Failed to verify file existence',
      );
    }
  }

  /**
   * Internal helper to call MediaService gRPC GetPresignedUploadUrl
   */
  private async generateUploadUrl(
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
