import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import { GetPresignedUrlDto } from './dto/get-presigned-url.dto';
import { MediaService } from './media.service';
import { RateLimit } from '../common';

@Controller('media')
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  /**
   * POST /api/v1/media/avatar/upload-url
   * Request presigned upload URL for user avatars.
   * Rate Limited: Max 10 requests per 15 minutes per IP.
   */
  @Post('avatar/upload-url')
  @RateLimit({ limit: 10, ttl: 900, prefix: 'avatar-upload' })
  @HttpCode(HttpStatus.OK)
  async getAvatarUploadUrl(@Body() dto: GetPresignedUrlDto) {
    return this.mediaService.getAvatarUploadUrl(dto);
  }

  /**
   * POST /api/v1/media/upload-url
   * Request presigned upload URLs by category.
   * Rate Limited: Max 20 requests per 15 minutes per IP.
   */
  @Post('upload-url')
  @RateLimit({ limit: 20, ttl: 900, prefix: 'media-upload' })
  @HttpCode(HttpStatus.OK)
  async getGeneralUploadUrl(@Body() dto: GetPresignedUrlDto) {
    return this.mediaService.getGeneralUploadUrl(dto);
  }

  /**
   * GET /api/v1/media/file-url?key=...
   * Retrieves access URL for a stored object
   */
  @Get('file-url')
  async getFileUrl(@Query('key') fileKey: string) {
    return this.mediaService.getFileUrl(fileKey);
  }

  /**
   * GET /api/v1/media/check-file?key=...
   * Verifies if a file exists in object storage
   */
  @Get('check-file')
  async checkFileExists(@Query('key') fileKey: string) {
    return this.mediaService.checkFileExists(fileKey);
  }
}
