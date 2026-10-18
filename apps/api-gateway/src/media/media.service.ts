import { Injectable } from '@nestjs/common';
import { UploadCategory } from '@skillup/shared/interfaces';
import { GetPresignedUrlDto } from './dto/get-presigned-url.dto';
import { UploadUrlProvider, FileQueryProvider } from './providers';

/**
 * MediaService (Facade)
 * Coordinates media operations by delegating to specialized providers
 * organized by endpoint category in the providers/ directory.
 */
@Injectable()
export class MediaService {
  constructor(
    private readonly uploadUrlProvider: UploadUrlProvider,
    private readonly fileQueryProvider: FileQueryProvider,
  ) {}

  /**
   * Request presigned upload URL specifically for avatar uploads
   */
  async getAvatarUploadUrl(dto: GetPresignedUrlDto) {
    return this.uploadUrlProvider.getAvatarUploadUrl(dto);
  }

  /**
   * Request presigned upload URL for general uploads by category
   */
  async getGeneralUploadUrl(dto: GetPresignedUrlDto) {
    return this.uploadUrlProvider.getGeneralUploadUrl(dto);
  }

  /**
   * Retrieve temporary or public access URL for a stored object
   */
  async getFileUrl(fileKey: string) {
    return this.fileQueryProvider.getFileUrl(fileKey);
  }

  /**
   * Verifies if a file exists in MinIO storage
   */
  async checkFileExists(fileKey: string) {
    return this.fileQueryProvider.checkFileExists(fileKey);
  }

  /**
   * Internal helper to generate presigned upload URLs
   */
  async generateUploadUrl(
    dto: GetPresignedUrlDto,
    category: UploadCategory | string,
  ) {
    return this.uploadUrlProvider.generateUploadUrl(dto, category);
  }
}
