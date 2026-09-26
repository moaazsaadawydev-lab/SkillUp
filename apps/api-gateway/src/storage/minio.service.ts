import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Minio from 'minio';
import { randomUUID } from 'crypto';
import 'multer';

@Injectable()
export class MinioService implements OnModuleInit {
  private readonly logger = new Logger(MinioService.name);
  private minioClient: Minio.Client;
  private readonly defaultBucket: string;

  constructor(private readonly configService: ConfigService) {
    const endPoint =
      this.configService.get<string>('MINIO_ENDPOINT') ||
      (process.env.NODE_ENV === 'production' ? 'minio' : 'localhost');
    const port = Number(this.configService.get<number>('MINIO_PORT', 9000));
    const useSSL = this.configService.get<string>('MINIO_USE_SSL') === 'true';
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

    this.minioClient = new Minio.Client({
      endPoint,
      port,
      useSSL,
      accessKey,
      secretKey,
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
              's3:prefix': ['profile_photos'],
            },
          },
        },
        {
          Effect: 'Allow',
          Principal: { AWS: ['*'] },
          Action: ['s3:GetObject'],
          Resource: [`arn:aws:s3:::${this.defaultBucket}/profile_photos*`],
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
   * Uploads an avatar/photo buffer to temporary storage in MinIO
   * Key pattern: tmp/{uuid}_{sanitizedOriginalName}
   */
  async uploadTempFile(
    file: Express.Multer.File,
  ): Promise<{ tempKey: string; bucket: string }> {
    const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    const tempKey = `tmp/${randomUUID()}_${sanitizedName}`;

    try {
      await this.minioClient.putObject(
        this.defaultBucket,
        tempKey,
        file.buffer,
        file.size,
        {
          'Content-Type': file.mimetype,
        },
      );

      this.logger.debug(
        `Uploaded temporary avatar file to MinIO: ${this.defaultBucket}/${tempKey}`,
      );

      return {
        tempKey,
        bucket: this.defaultBucket,
      };
    } catch (error) {
      this.logger.error(
        `Failed to upload file to MinIO: ${tempKey}`,
        error instanceof Error ? error.stack : error,
      );
      throw error;
    }
  }

  getClient(): Minio.Client {
    return this.minioClient;
  }

  getDefaultBucket(): string {
    return this.defaultBucket;
  }
}
