import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Minio from 'minio';
import { Readable } from 'stream';

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
    } catch (error) {
      this.logger.warn(
        `Could not verify/create MinIO bucket "${this.defaultBucket}": ${
          error instanceof Error ? error.message : error
        }`,
      );
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
