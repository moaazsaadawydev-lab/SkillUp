import { Observable } from 'rxjs';

export const MEDIA_PACKAGE_NAME = 'media';
export const MEDIA_SERVICE_NAME = 'MediaService';

export enum UploadCategory {
  AVATAR = 'AVATAR',
  COVER = 'COVER',
  COURSE_ATTACHMENT = 'COURSE_ATTACHMENT',
  DOCUMENT = 'DOCUMENT',
}

// =============================================================================
// Data Contracts (DTOs)
// =============================================================================

export interface PresignedUploadUrlRequest {
  filename: string;
  contentType: string;
  content_type?: string;
  fileSize: number;
  file_size?: number;
  category: UploadCategory | string;
  userId?: string;
  user_id?: string;
}

export interface PresignedUploadUrlResponse {
  success: boolean;
  message?: string;
  uploadUrl: string;
  upload_url?: string;
  fileKey: string;
  file_key?: string;
  expiresIn: number;
  expires_in?: number;
}

export interface GetFileUrlRequest {
  fileKey: string;
  file_key?: string;
}

export interface FileUrlResponse {
  url: string;
  expiresIn: number;
  expires_in?: number;
}

export interface CheckFileExistsRequest {
  fileKey: string;
  file_key?: string;
  bucket?: string;
}

export interface CheckFileExistsResponse {
  exists: boolean;
  fileSize?: number;
  file_size?: number;
  contentType?: string;
  content_type?: string;
}

export interface DeleteFileRequest {
  fileKey: string;
  file_key?: string;
  bucket?: string;
}

export interface DeleteFileResponse {
  success: boolean;
  message?: string;
}

// =============================================================================
// gRPC Client & Controller Interfaces
// =============================================================================

export interface MediaServiceClient {
  getPresignedUploadUrl(
    request: PresignedUploadUrlRequest,
  ): Observable<PresignedUploadUrlResponse>;
  getFileUrl(request: GetFileUrlRequest): Observable<FileUrlResponse>;
  checkFileExists(
    request: CheckFileExistsRequest,
  ): Observable<CheckFileExistsResponse>;
  deleteFile(request: DeleteFileRequest): Observable<DeleteFileResponse>;
}

export interface MediaServiceController {
  getPresignedUploadUrl(
    request: PresignedUploadUrlRequest,
  ):
    | Promise<PresignedUploadUrlResponse>
    | Observable<PresignedUploadUrlResponse>
    | PresignedUploadUrlResponse;
  getFileUrl(
    request: GetFileUrlRequest,
  ): Promise<FileUrlResponse> | Observable<FileUrlResponse> | FileUrlResponse;
  checkFileExists(
    request: CheckFileExistsRequest,
  ):
    | Promise<CheckFileExistsResponse>
    | Observable<CheckFileExistsResponse>
    | CheckFileExistsResponse;
  deleteFile(
    request: DeleteFileRequest,
  ):
    | Promise<DeleteFileResponse>
    | Observable<DeleteFileResponse>
    | DeleteFileResponse;
}
