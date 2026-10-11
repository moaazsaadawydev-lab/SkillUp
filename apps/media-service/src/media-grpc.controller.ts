import { Controller, Logger } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import {
  MEDIA_SERVICE_NAME,
  MediaServiceController,
  PresignedUploadUrlRequest,
  PresignedUploadUrlResponse,
  GetFileUrlRequest,
  FileUrlResponse,
  CheckFileExistsRequest,
  CheckFileExistsResponse,
  DeleteFileRequest,
  DeleteFileResponse,
} from '@skillup/shared/interfaces';
import { MediaService } from './media.service';

@Controller()
export class MediaGrpcController implements MediaServiceController {
  private readonly logger = new Logger(MediaGrpcController.name);

  constructor(private readonly mediaService: MediaService) {}

  @GrpcMethod(MEDIA_SERVICE_NAME, 'GetPresignedUploadUrl')
  async getPresignedUploadUrl(
    request: PresignedUploadUrlRequest,
  ): Promise<PresignedUploadUrlResponse> {
    this.logger.debug(
      `gRPC GetPresignedUploadUrl called: filename="${request.filename}", category="${request.category}"`,
    );
    return this.mediaService.getPresignedUploadUrl(request);
  }

  @GrpcMethod(MEDIA_SERVICE_NAME, 'GetFileUrl')
  async getFileUrl(request: GetFileUrlRequest): Promise<FileUrlResponse> {
    this.logger.debug(
      `gRPC GetFileUrl called for key: ${request.fileKey || request.file_key}`,
    );
    return this.mediaService.getFileUrl(request);
  }

  @GrpcMethod(MEDIA_SERVICE_NAME, 'CheckFileExists')
  async checkFileExists(
    request: CheckFileExistsRequest,
  ): Promise<CheckFileExistsResponse> {
    this.logger.debug(
      `gRPC CheckFileExists called for key: ${request.fileKey || request.file_key}`,
    );
    return this.mediaService.checkFileExists(request);
  }

  @GrpcMethod(MEDIA_SERVICE_NAME, 'DeleteFile')
  async deleteFile(request: DeleteFileRequest): Promise<DeleteFileResponse> {
    this.logger.debug(
      `gRPC DeleteFile called for key: ${request.fileKey || request.file_key}`,
    );
    return this.mediaService.deleteFile(request);
  }
}
