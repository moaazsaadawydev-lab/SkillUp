import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Minio from 'minio';
import { Readable } from 'stream';

@Injectable()
export class MinioService implements OnModuleInit {
  private readonly logger = new Logger(MinioService.name);
  private minioClient: Minio.Client;
  private presignClient: Minio.Client;
  private readonly defaultBucket: string;

  constructor(private readonly configService: ConfigService) {
    const endPoint =
      this.configService.get<string>('MINIO_ENDPOINT') ||
      (process.env.NODE_ENV === 'production' ? 'minio' : 'localhost');
    const port = Number(this.configService.get<number>('MINIO_PORT', 9000));
    const useSSL =
      this.configService.get<string>('MINIO_USE_SSL') === 'true' ||
      this.configService.get<boolean>('MINIO_USE_SSL') === true;
    const accessKey = this.configService.get<string>(
      'MINIO_ACCESS_KEY',
      'minioadmin',
    );
    const secretKey = this.configService.get<string>(
      'MINIO_SECRET_KEY',
      'minioadmin',
    );
    this.defaultBucket = this.configService.get<string>(
      'MINIO_DEFAULT_BUCKET',
      'skillhub-media',
    );

    const region =
      this.configService.get<string>('MINIO_REGION') || 'us-east-1';

    // Internal client (communicates across Docker network, e.g. minio:9000)
    this.minioClient = new Minio.Client({
      endPoint,
      port,
      useSSL,
      accessKey,
      secretKey,
      region,
    });

    // Public/Host client (used for generating signatures accessible by external clients, e.g. localhost:9000)
    const publicEndPoint =
      this.configService.get<string>('MINIO_HOST_ENDPOINT') ||
      this.configService.get<string>('MINIO_PUBLIC_ENDPOINT') ||
      (process.env.NODE_ENV === 'production' && endPoint === 'minio'
        ? 'localhost'
        : endPoint);
    const publicPort = Number(
      this.configService.get<number>('MINIO_PUBLIC_PORT') ||
        this.configService.get<number>('MINIO_PORT', 9000),
    );
    const publicUseSSL =
      this.configService.get<string>('MINIO_PUBLIC_USE_SSL') === 'true' ||
      this.configService.get<boolean>('MINIO_PUBLIC_USE_SSL') === true ||
      useSSL;

    this.presignClient = new Minio.Client({
      endPoint: publicEndPoint,
      port: publicPort,
      useSSL: publicUseSSL,
      accessKey,
      secretKey,
      region,
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      const exists = await this.minioClient.bucketExists(this.defaultBucket);
      if (!exists) {
        await this.minioClient.makeBucket(this.defaultBucket);
        this.logger.log(`Created default MinIO bucket: ${this.defaultBucket}`);
      } else {
        this.logger.log(`MinIO bucket "${this.defaultBucket}" is ready.`);
      }

      await this.ensurePublicReadPolicy();
      await this.ensureLifecyclePolicy();
    } catch (error) {
      this.logger.warn(
        `Could not verify/create MinIO bucket "${this.defaultBucket}": ${
          error instanceof Error ? error.message : error
        }`,
      );
    }
  }

  /**
   * Enforces anonymous public download policy specifically on profile_photos path
   */
  private async ensurePublicReadPolicy(): Promise<void> {
    const policy = {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: { AWS: ['*'] },
          Action: ['s3:GetBucketLocation'],
          Resource: [`arn:aws:s3:::${this.defaultBucket}`],
        },
        {
          Effect: 'Allow',
          Principal: { AWS: ['*'] },
          Action: ['s3:ListBucket'],
          Resource: [`arn:aws:s3:::${this.defaultBucket}`],
          Condition: {
            StringEquals: {
              's3:prefix': ['profile_photos', 'avatars'],
            },
          },
        },
        {
          Effect: 'Allow',
          Principal: { AWS: ['*'] },
          Action: ['s3:GetObject'],
          Resource: [
            `arn:aws:s3:::${this.defaultBucket}/profile_photos*`,
            `arn:aws:s3:::${this.defaultBucket}/avatars*`,
          ],
        },
      ],
    };

    try {
      await this.minioClient.setBucketPolicy(
        this.defaultBucket,
        JSON.stringify(policy),
      );
      this.logger.debug(
        `Applied public read-only policy for "${this.defaultBucket}/profile_photos*"`,
      );
    } catch (err) {
      this.logger.warn(
        `Failed to set bucket policy on "${this.defaultBucket}": ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
  }

  /**
   * Applies an automated ILM lifecycle rule to automatically expire and delete
   * temporary unconfirmed uploads after 1 day (24 hours).
   */
  private async ensureLifecyclePolicy(): Promise<void> {
    const lifecycleConfig: Minio.LifecycleConfig = {
      Rule: [
        {
          ID: 'ExpireTempUploadsAfter1Day',
          Status: 'Enabled',
          Filter: { Prefix: 'temp_uploads/' },
          Expiration: { Days: 1 },
        },
      ],
    };

    try {
      await this.minioClient.setBucketLifecycle(
        this.defaultBucket,
        lifecycleConfig,
      );
      this.logger.debug(
        `Applied ILM lifecycle policy on "${this.defaultBucket}/temp_uploads/*" (expire after 1 day)`,
      );
    } catch (err: unknown) {
      this.logger.warn(
        `Failed to set bucket lifecycle on "${this.defaultBucket}": ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
  }

  /**
   * Generates a presigned PUT URL allowing clients to upload directly to MinIO
   * @param key Target object key in bucket (e.g. temp_uploads/avatars/...)
   * @param expirySeconds Expiration TTL in seconds (default: 300s = 5m)
   * @param bucket Target bucket
   */
  async getPresignedUploadUrl(
    key: string,
    expirySeconds = 300,
    bucket?: string,
  ): Promise<string> {
    const targetBucket = bucket || this.defaultBucket;
    return this.presignClient.presignedPutObject(
      targetBucket,
      key,
      expirySeconds,
    );
  }

  /**
   * Generates a presigned GET URL allowing clients to download private objects
   */
  async getPresignedGetUrl(
    key: string,
    expirySeconds = 3600,
    bucket?: string,
  ): Promise<string> {
    const targetBucket = bucket || this.defaultBucket;
    return this.presignClient.presignedGetObject(
      targetBucket,
      key,
      expirySeconds,
    );
  }

  /**
   * Checks whether an object exists in MinIO and returns its metadata
   */
  async checkFileExists(
    key: string,
    bucket?: string,
  ): Promise<{ exists: boolean; size?: number; contentType?: string }> {
    const targetBucket = bucket || this.defaultBucket;
    try {
      const stat = await this.minioClient.statObject(targetBucket, key);
      return {
        exists: true,
        size: stat.size,
        contentType:
          stat.metaData?.['content-type'] || 'application/octet-stream',
      };
    } catch (err: unknown) {
      const anyErr = err as { code?: string; message?: string };
      if (
        anyErr?.code === 'NotFound' ||
        anyErr?.code === 'NoSuchKey' ||
        anyErr?.message?.includes('Not Found')
      ) {
        return { exists: false };
      }
      this.logger.warn(
        `Error checking file existence for "${key}": ${anyErr?.message || err}`,
      );
      return { exists: false };
    }
  }

  /**
   * Retrieves an object as a Buffer from MinIO storage
   */
  async getObject(key: string, bucket?: string): Promise<Buffer> {
    const targetBucket = bucket || this.defaultBucket;
    const stream = await this.minioClient.getObject(targetBucket, key);

    return new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      stream.on('error', (err) => reject(err));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
    });
  }

  /**
   * Uploads an object buffer to MinIO storage
   */
  async putObject(
    key: string,
    buffer: Buffer,
    contentType: string,
    bucket?: string,
  ): Promise<void> {
    const targetBucket = bucket || this.defaultBucket;
    await this.minioClient.putObject(
      targetBucket,
      key,
      buffer,
      buffer.length,
      {
        'Content-Type': contentType,
      },
    );
  }

  /**
   * Deletes an object from MinIO storage
   */
  async deleteObject(key: string, bucket?: string): Promise<void> {
    const targetBucket = bucket || this.defaultBucket;
    await this.minioClient.removeObject(targetBucket, key);
  }

  getClient(): Minio.Client {
    return this.minioClient;
  }

  getDefaultBucket(): string {
    return this.defaultBucket;
  }
}
