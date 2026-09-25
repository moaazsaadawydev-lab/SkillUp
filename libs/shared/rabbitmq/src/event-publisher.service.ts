import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ChannelWrapper, AmqpConnectionManager } from 'amqp-connection-manager';
import {
  RABBITMQ_CHANNEL,
  RABBITMQ_CONNECTION,
  RABBITMQ_MODULE_OPTIONS,
  DEFAULT_EXCHANGE_NAME,
} from './rabbitmq.constants';
import {
  PublishEventOptions,
  RabbitMQModuleOptions,
} from './rabbitmq.interfaces';

@Injectable()
export class EventPublisherService implements OnModuleDestroy {
  private readonly logger = new Logger(EventPublisherService.name);

  constructor(
    @Inject(RABBITMQ_CHANNEL) private readonly channelWrapper: ChannelWrapper,
    @Inject(RABBITMQ_CONNECTION)
    private readonly connectionManager: AmqpConnectionManager,
    @Inject(RABBITMQ_MODULE_OPTIONS)
    private readonly options: RabbitMQModuleOptions,
  ) {}

  /**
   * Return the underlying ChannelWrapper for advanced channel operations
   */
  getChannelWrapper(): ChannelWrapper {
    return this.channelWrapper;
  }

  /**
   * Return the underlying AmqpConnectionManager
   */
  getConnectionManager(): AmqpConnectionManager {
    return this.connectionManager;
  }

  /**
   * Publish an event to the RabbitMQ exchange with publisher confirms and persistent delivery.
   */
  async publishEvent<T>(
    routingKey: string,
    payload: T,
    options?: PublishEventOptions | Record<string, any>,
  ): Promise<boolean> {
    const exchange =
      (options as PublishEventOptions)?.exchange ||
      this.options.defaultExchange ||
      DEFAULT_EXCHANGE_NAME;

    const messageId =
      (options as PublishEventOptions)?.messageId || randomUUID();
    const timestamp = Date.now();

    // Check if options contains nested headers or is treated as headers object
    const isOptionsObject =
      options &&
      ('exchange' in options ||
        'correlationId' in options ||
        'headers' in options ||
        'persistent' in options);

    const headers = isOptionsObject
      ? (options as PublishEventOptions)?.headers || {}
      : options || {};

    const correlationId = isOptionsObject
      ? (options as PublishEventOptions)?.correlationId
      : undefined;

    const publishOptions = {
      persistent: true, // deliveryMode: 2
      contentType: 'application/json',
      contentEncoding: 'utf-8',
      messageId,
      timestamp,
      headers,
      correlationId,
      ...(isOptionsObject ? options : {}),
    };

    try {
      const buffer = Buffer.from(JSON.stringify(payload));
      await this.channelWrapper.publish(
        exchange,
        routingKey,
        buffer,
        publishOptions,
      );

      this.logger.debug(
        `[RabbitMQ] Event published successfully: [${exchange} -> ${routingKey}] (ID: ${messageId})`,
      );
      return true;
    } catch (error) {
      this.logger.error(
        `[RabbitMQ] Failed to publish event: [${exchange} -> ${routingKey}] (ID: ${messageId})`,
        error instanceof Error ? error.stack : error,
      );
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      this.logger.log('Closing RabbitMQ channel and connection...');
      await this.channelWrapper.close();
      await this.connectionManager.close();
      this.logger.log('RabbitMQ channel and connection closed gracefully.');
    } catch (error) {
      this.logger.warn(
        `Error closing RabbitMQ connection: ${
          error instanceof Error ? error.message : error
        }`,
      );
    }
  }
}
