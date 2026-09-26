import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConfirmChannel, ConsumeMessage } from 'amqplib';
import { ChannelWrapper, AmqpConnectionManager } from 'amqp-connection-manager';
import {
  RABBITMQ_CONNECTION,
  DEFAULT_EXCHANGE_NAME,
  DEFAULT_EXCHANGE_TYPE,
} from '@skillup/shared/rabbitmq';
import { RABBITMQ_ROUTING_KEYS } from '@skillup/shared/constants';
import { ImageTransformations } from '@skillup/shared/interfaces';
import { MinioService } from '../storage/minio.service';
import { ImageProcessorService } from '../processors/image-processor.service';

export interface ProcessProfilePhotoPayload {
  userId: string;
  tempKey: string;
  targetKey: string;
  transformations?: ImageTransformations;
}

@Injectable()
export class MediaConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MediaConsumerService.name);
  private channelWrapper: ChannelWrapper;

  constructor(
    @Inject(RABBITMQ_CONNECTION)
    private readonly connectionManager: AmqpConnectionManager,
    private readonly configService: ConfigService,
    private readonly minioService: MinioService,
    private readonly imageProcessor: ImageProcessorService,
  ) {}

  async onModuleInit(): Promise<void> {
    const queueName =
      this.configService.get<string>('RABBITMQ_MEDIA_QUEUE') || 'media_queue';
    const exchangeName =
      this.configService.get<string>('RABBITMQ_DEFAULT_EXCHANGE') ||
      DEFAULT_EXCHANGE_NAME;
    const routingKey = RABBITMQ_ROUTING_KEYS.PROCESS_PHOTO;

    this.channelWrapper = this.connectionManager.createChannel({
      json: false,
      setup: async (channel: ConfirmChannel) => {
        this.logger.log(
          `Setting up RabbitMQ consumer: Queue="${queueName}", Exchange="${exchangeName}", RoutingKey="${routingKey}"`,
        );

        // Assert topic exchange
        await channel.assertExchange(exchangeName, DEFAULT_EXCHANGE_TYPE, {
          durable: true,
        });

        // Assert durable media queue
        await channel.assertQueue(queueName, {
          durable: true,
        });

        // Bind queue to exchange
        await channel.bindQueue(queueName, exchangeName, routingKey);
        await channel.bindQueue(queueName, exchangeName, 'media.#');

        // Prefetch limit
        await channel.prefetch(2);

        // Start consuming messages
        await channel.consume(
          queueName,
          async (msg: ConsumeMessage | null) => {
            if (!msg) return;

            try {
              const content = msg.content.toString('utf-8');
              const payload = JSON.parse(content);

              this.logger.debug(
                `[RabbitMQ] Received photo processing message: ${msg.properties.messageId || 'no-id'}`,
              );

              await this.handlePhotoProcess(payload);

              // Acknowledge message successfully
              channel.ack(msg);
              this.logger.debug(
                `[RabbitMQ] Message ${msg.properties.messageId || ''} processed and ACKed.`,
              );
            } catch (error) {
              this.logger.error(
                `[RabbitMQ] Failed to process message ${msg.properties.messageId || ''}:`,
                error instanceof Error ? error.stack : error,
              );

              // Reject and do not requeue poison pills to prevent infinite loops
              channel.nack(msg, false, false);
            }
          },
          { noAck: false },
        );

        this.logger.log(
          `RabbitMQ consumer successfully registered on queue: ${queueName}`,
        );
      },
    });

    this.channelWrapper.on('connect', () => {
      this.logger.log('MediaConsumer channel connected.');
    });

    this.channelWrapper.on('error', (err) => {
      this.logger.error('MediaConsumer channel error:', err);
    });
  }

  /**
   * Main photo processing logic:
   * 1. Downloads raw image buffer from MinIO using tempKey.
   * 2. Transforms, crops, resizes (500x500), applies circular mask, and converts to WebP.
   * 3. Uploads processed WebP buffer to MinIO using targetKey.
   * 4. Cleans up temporary object from MinIO at tempKey.
   */
  async handlePhotoProcess(payload: ProcessProfilePhotoPayload): Promise<void> {
    const { userId, tempKey, targetKey, transformations } = payload;

    if (!tempKey || !targetKey) {
      this.logger.warn(
        `Invalid payload received, missing tempKey or targetKey: ${JSON.stringify(payload)}`,
      );
      return;
    }

    this.logger.log(
      `Starting avatar processing for user ${userId}: from "${tempKey}" to "${targetKey}"`,
    );

    // 1. Download raw image from MinIO
    const rawBuffer = await this.minioService.getObject(tempKey);
    this.logger.debug(
      `Downloaded raw buffer for user ${userId} (${rawBuffer.length} bytes)`,
    );

    // 2. Process image with sharp (crop, resize 500x500, circular mask, webp)
    const processedBuffer = await this.imageProcessor.processProfileAvatar(
      rawBuffer,
      transformations,
    );
    this.logger.debug(
      `Processed avatar for user ${userId} (${processedBuffer.length} bytes)`,
    );

    // 3. Upload processed WebP image to target key
    await this.minioService.putObject(targetKey, processedBuffer, 'image/webp');
    this.logger.log(
      `Uploaded processed avatar to permanent location: "${targetKey}"`,
    );

    // 4. Delete temporary raw file from MinIO
    try {
      await this.minioService.deleteObject(tempKey);
      this.logger.debug(`Deleted temporary avatar file: "${tempKey}"`);
    } catch (delError) {
      this.logger.warn(
        `Failed to delete temporary file "${tempKey}": ${
          delError instanceof Error ? delError.message : delError
        }`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.channelWrapper) {
      try {
        await this.channelWrapper.close();
      } catch (err) {
        this.logger.warn(
          'Error closing MediaConsumer channel:',
          err instanceof Error ? err.message : err,
        );
      }
    }
  }
}
