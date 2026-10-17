import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  PresignedUploadUrlRequest,
  PresignedUploadUrlResponse,
  GetFileUrlRequest,
  FileUrlResponse,
  CheckFileExistsRequest,
  CheckFileExistsResponse,
  DeleteFileRequest,
  DeleteFileResponse,
  UploadCategory,
} from '@skillup/shared/interfaces';
import { MinioService } from './storage/minio.service';

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  // Maximum upload size for avatars: 5 MB
  private readonly MAX_AVATAR_SIZE = 5 * 1024 * 1024;

  // Allowed MIME types for images
  private readonly ALLOWED_IMAGE_MIMES = [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
  ];

  constructor(private readonly minioService: MinioService) {}

  /**
   * Generates a presigned PUT URL for client-direct upload to MinIO.
   * Performs validation on file extension, MIME type, and size constraints.
   */
  async getPresignedUploadUrl(
    request: PresignedUploadUrlRequest,
  ): Promise<PresignedUploadUrlResponse> {
    const rawFilename = request.filename || 'upload.jpg';
    const sanitizedFilename = rawFilename
      .replace(/[^a-zA-Z0-9.-]/g, '_')
      .toLowerCase();

    const contentType = (
      request.contentType ||
      request.content_type ||
      ''
    ).toLowerCase();
    const fileSize = Number(request.fileSize || request.file_size || 0);
    const category = (request.category || UploadCategory.AVATAR)
      .toString()
      .toUpperCase();

    // 1. Validate MIME type
    if (contentType && !this.ALLOWED_IMAGE_MIMES.includes(contentType)) {
      this.logger.warn(
        `Rejected presigned URL request: unsupported MIME type "${contentType}"`,
      );
      return {
        success: false,
        message: `Unsupported content type "${contentType}". Allowed types: JPEG, PNG, WebP.`,
        uploadUrl: '',
        upload_url: '',
        fileKey: '',
        file_key: '',
        expiresIn: 0,
        expires_in: 0,
      };
    }

    // 2. Validate file size for avatars
    if (category === UploadCategory.AVATAR && fileSize > this.MAX_AVATAR_SIZE) {
      this.logger.warn(
        `Rejected presigned URL request: file size ${fileSize} exceeds max avatar limit of 5MB`,
      );
      return {
        success: false,
        message: 'File size exceeds the maximum allowed limit of 5MB.',
        uploadUrl: '',
        upload_url: '',
        fileKey: '',
        file_key: '',
        expiresIn: 0,
        expires_in: 0,
      };
    }

    // 3. Determine storage folder based on category
    let folder = 'temp_uploads/general';
    if (category === UploadCategory.AVATAR || category === 'AVATAR') {
      folder = 'temp_uploads/avatars';
    } else if (category === UploadCategory.COVER || category === 'COVER') {
      folder = 'temp_uploads/covers';
    } else if (
      category === UploadCategory.DOCUMENT ||
      category === 'DOCUMENT'
    ) {
      folder = 'temp_uploads/documents';
    }

    const fileKey = `${folder}/${randomUUID()}_${sanitizedFilename}`;
    const expiresIn = 300; // 5 minutes TTL

    try {
      const uploadUrl = await this.minioService.getPresignedUploadUrl(
        fileKey,
        expiresIn,
      );

      this.logger.log(
        `Generated presigned upload URL for key="${fileKey}", category="${category}", expiresIn=${expiresIn}s`,
      );

      return {
        success: true,
        message: 'Presigned upload URL generated successfully.',
        uploadUrl,
        upload_url: uploadUrl,
        fileKey,
        file_key: fileKey,
        expiresIn,
        expires_in: expiresIn,
      };
    } catch (error) {
      this.logger.error(
        `Failed to generate presigned upload URL for key="${fileKey}":`,
        error instanceof Error ? error.stack : error,
      );
      return {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to generate presigned upload URL.',
        uploadUrl: '',
        upload_url: '',
        fileKey: '',
        file_key: '',
        expiresIn: 0,
        expires_in: 0,
      };
    }
  }

  /**
   * Checks if an object exists in MinIO storage.
   */
  async checkFileExists(
    request: CheckFileExistsRequest,
  ): Promise<CheckFileExistsResponse> {
    const fileKey = request.fileKey || request.file_key;
    if (!fileKey) {
      return {
        exists: false,
        fileSize: 0,
        file_size: 0,
        contentType: '',
        content_type: '',
      };
    }

    const result = await this.minioService.checkFileExists(
      fileKey,
      request.bucket,
    );
    return {
      exists: result.exists,
      fileSize: result.size || 0,
      file_size: result.size || 0,
      contentType: result.contentType || '',
      content_type: result.contentType || '',
    };
  }

  /**
   * Retrieves a URL for an existing file.
   */
  async getFileUrl(request: GetFileUrlRequest): Promise<FileUrlResponse> {
    const fileKey = request.fileKey || request.file_key;
    if (!fileKey) {
      return { url: '', expiresIn: 0, expires_in: 0 };
    }

    const expiresIn = 3600; // 1 hour
    const url = await this.minioService.getPresignedGetUrl(fileKey, expiresIn);
    return {
      url,
      expiresIn,
      expires_in: expiresIn,
    };
  }

  /**
   * Deletes a file from MinIO storage.
   */
  async deleteFile(request: DeleteFileRequest): Promise<DeleteFileResponse> {
    const fileKey = request.fileKey || request.file_key;
    if (!fileKey) {
      return { success: false, message: 'File key is required.' };
    }

    try {
      await this.minioService.deleteObject(fileKey, request.bucket);
      return { success: true, message: 'File deleted successfully.' };
    } catch (error) {
      this.logger.error(
        `Failed to delete file "${fileKey}":`,
        error instanceof Error ? error.stack : error,
      );
      return { success: false, message: 'Failed to delete file.' };
    }
  }
}
