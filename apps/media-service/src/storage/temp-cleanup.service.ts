import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MinioService } from './minio.service';

@Injectable()
export class TempCleanupService implements OnApplicationBootstrap {
  private readonly logger = new Logger(TempCleanupService.name);
  private isCleaning = false;

  // Maximum allowed age for temporary uploads: 2 hours in milliseconds
  private readonly MAX_TEMP_AGE_MS = 2 * 60 * 60 * 1000;

  constructor(private readonly minioService: MinioService) {}

  onApplicationBootstrap() {
    // Run an initial sweep 15 seconds after application boot to clean lingering files
    setTimeout(() => {
      this.cleanExpiredTempUploads().catch((err) =>
        this.logger.error('Initial temp cleanup sweep failed:', err),
      );
    }, 15000);
  }

  /**
   * Periodic cron scheduled every 30 minutes to clean unconfirmed temporary files older than 2 hours.
   */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async handleCronCleanup(): Promise<void> {
    await this.cleanExpiredTempUploads();
  }

  /**
   * Scans temp_uploads/ prefix in MinIO and purges any file whose age exceeds 2 hours.
   */
  async cleanExpiredTempUploads(): Promise<void> {
    if (this.isCleaning) {
      this.logger.debug('Temp cleanup task already in progress, skipping cycle.');
      return;
    }

    this.isCleaning = true;
    const bucket = this.minioService.getDefaultBucket();
    const prefix = 'temp_uploads/';
    const client = this.minioService.getClient();

    this.logger.log(`[TempCleanup] Starting sweep for expired temp uploads in "${bucket}/${prefix}"...`);

    let inspectedCount = 0;
    let deletedCount = 0;
    const now = Date.now();

    try {
      const stream = client.listObjectsV2(bucket, prefix, true);

      for await (const item of stream) {
        if (!item || !item.name) continue;
        inspectedCount++;

        const lastModified = item.lastModified ? new Date(item.lastModified).getTime() : now;
        const ageMs = now - lastModified;

        if (ageMs >= this.MAX_TEMP_AGE_MS) {
          const ageHours = (ageMs / (1000 * 60 * 60)).toFixed(2);
          try {
            await this.minioService.deleteObject(item.name, bucket);
            deletedCount++;
            this.logger.log(
              `[TempCleanup] Purged expired temporary file: "${item.name}" (Age: ${ageHours}h, Size: ${item.size} bytes)`,
            );
          } catch (delError) {
            this.logger.warn(
              `[TempCleanup] Failed to delete expired object "${item.name}": ${
                delError instanceof Error ? delError.message : delError
              }`,
            );
          }
        }
      }

      this.logger.log(
        `[TempCleanup] Sweep completed: ${inspectedCount} files inspected, ${deletedCount} expired files purged (threshold: 2 hours).`,
      );
    } catch (error) {
      this.logger.error(
        '[TempCleanup] Error while scanning temp uploads:',
        error instanceof Error ? error.stack : error,
      );
    } finally {
      this.isCleaning = false;
    }
  }
}
