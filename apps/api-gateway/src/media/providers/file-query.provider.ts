import {
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import {
  MEDIA_SERVICE_NAME,
  MediaServiceClient,
} from '@skillup/shared/interfaces';

@Injectable()
export class FileQueryProvider implements OnModuleInit {
  private readonly logger = new Logger(FileQueryProvider.name);
  private mediaServiceClient: MediaServiceClient;

  constructor(
    @Inject(MEDIA_SERVICE_NAME) private readonly grpcClient: ClientGrpc,
  ) {}

  onModuleInit() {
    this.mediaServiceClient =
      this.grpcClient.getService<MediaServiceClient>(MEDIA_SERVICE_NAME);
  }

  /**
   * Retrieve temporary or public access URL for a stored object
   */
  async getFileUrl(fileKey: string) {
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
   * Verifies if a file exists in MinIO storage
   */
  async checkFileExists(fileKey: string) {
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
   * Deletes a file from MinIO storage via gRPC
   */
  async deleteFile(fileKey: string) {
    if (!fileKey) {
      throw new BadRequestException('File key is required for deletion');
    }

    try {
      const response = await firstValueFrom(
        this.mediaServiceClient.deleteFile({ fileKey }),
      );
      return response;
    } catch (error: any) {
      this.logger.error(`gRPC DeleteFile failed for key="${fileKey}":`, error);
      return { success: false, message: 'Failed to delete file' };
    }
  }
}
