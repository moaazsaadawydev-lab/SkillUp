import { Module } from '@nestjs/common';
import { MinioService } from './minio.service';
import { TempCleanupService } from './temp-cleanup.service';

@Module({
  providers: [MinioService, TempCleanupService],
  exports: [MinioService, TempCleanupService],
})
export class StorageModule {}
