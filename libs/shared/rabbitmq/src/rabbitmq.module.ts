import {
  DynamicModule,
  Global,
  Logger,
  Module,
  Provider,
} from '@nestjs/common';
import amqp, {
  AmqpConnectionManager,
  ChannelWrapper,
} from 'amqp-connection-manager';
import { ConfirmChannel } from 'amqplib';
import {
  DEFAULT_EXCHANGE_NAME,
  DEFAULT_EXCHANGE_TYPE,
  RABBITMQ_CHANNEL,
  RABBITMQ_CONNECTION,
  RABBITMQ_MODULE_OPTIONS,
} from './rabbitmq.constants';
import {
  RabbitMQModuleAsyncOptions,
  RabbitMQModuleOptions,
  RabbitMQOptionsFactory,
} from './rabbitmq.interfaces';
import { EventPublisherService } from './event-publisher.service';

@Global()
@Module({})
export class RabbitMQModule {
  private static readonly logger = new Logger(RabbitMQModule.name);

  static forRoot(options: RabbitMQModuleOptions): DynamicModule {
    const connectionProvider: Provider = {
      provide: RABBITMQ_CONNECTION,
      useFactory: () => this.createConnection(options),
    };

    const channelProvider: Provider = {
      provide: RABBITMQ_CHANNEL,
      inject: [RABBITMQ_CONNECTION],
      useFactory: (connection: AmqpConnectionManager) =>
        this.createChannel(connection, options),
    };

    return {
      module: RabbitMQModule,
      providers: [
        {
          provide: RABBITMQ_MODULE_OPTIONS,
          useValue: options,
        },
        connectionProvider,
        channelProvider,
        EventPublisherService,
      ],
      exports: [
        RABBITMQ_CONNECTION,
        RABBITMQ_CHANNEL,
        EventPublisherService,
      ],
    };
  }

  static forRootAsync(options: RabbitMQModuleAsyncOptions): DynamicModule {
    const connectionProvider: Provider = {
      provide: RABBITMQ_CONNECTION,
      inject: [RABBITMQ_MODULE_OPTIONS],
      useFactory: (opts: RabbitMQModuleOptions) => this.createConnection(opts),
    };

    const channelProvider: Provider = {
      provide: RABBITMQ_CHANNEL,
      inject: [RABBITMQ_CONNECTION, RABBITMQ_MODULE_OPTIONS],
      useFactory: (
        connection: AmqpConnectionManager,
        opts: RabbitMQModuleOptions,
      ) => this.createChannel(connection, opts),
    };

    const asyncProviders = this.createAsyncProviders(options);

    return {
      module: RabbitMQModule,
      imports: options.imports || [],
      providers: [
        ...asyncProviders,
        connectionProvider,
        channelProvider,
        EventPublisherService,
      ],
      exports: [
        RABBITMQ_CONNECTION,
        RABBITMQ_CHANNEL,
        EventPublisherService,
      ],
    };
  }

  private static createConnection(
    options: RabbitMQModuleOptions,
  ): AmqpConnectionManager {
    const urls = Array.isArray(options.urls) ? options.urls : [options.urls];

    const connection = amqp.connect(urls, {
      heartbeatIntervalInSeconds: options.heartbeatIntervalInSeconds || 5,
      reconnectTimeInSeconds: options.reconnectTimeInSeconds || 5,
      connectionOptions: {
        clientProperties: {
          connection_name: options.connectionName || 'SkillHub-Microservice',
        },
      },
    });

    connection.on('connect', () => {
      this.logger.log('Successfully connected to RabbitMQ broker.');
    });

    connection.on('disconnect', (params: { err: Error }) => {
      this.logger.warn(
        `Disconnected from RabbitMQ broker: ${params?.err?.message || 'unknown error'}`,
      );
    });

    connection.on('connectFailed', (params: { err: Error; url?: string }) => {
      this.logger.error(
        `Failed to connect to RabbitMQ broker at ${params?.url || 'default URL'}: ${
          params?.err?.message || 'unknown error'
        }`,
      );
    });

    return connection;
  }

  private static createChannel(
    connection: AmqpConnectionManager,
    options: RabbitMQModuleOptions,
  ): ChannelWrapper {
    const exchange = options.defaultExchange || DEFAULT_EXCHANGE_NAME;
    const exchangeType = options.exchangeType || DEFAULT_EXCHANGE_TYPE;

    const channelWrapper = connection.createChannel({
      json: false,
      setup: async (channel: ConfirmChannel) => {
        this.logger.log(
          `Asserting RabbitMQ exchange: "${exchange}" (type: ${exchangeType}, durable: true)`,
        );
        await channel.assertExchange(exchange, exchangeType, {
          durable: true,
        });
      },
    });

    channelWrapper.on('connect', () => {
      this.logger.log('RabbitMQ channel created and exchange asserted.');
    });

    channelWrapper.on('error', (err: Error) => {
      this.logger.error(
        `RabbitMQ channel error: ${err?.message || 'unknown error'}`,
      );
    });

    channelWrapper.on('close', () => {
      this.logger.warn('RabbitMQ channel closed.');
    });

    return channelWrapper;
  }

  private static createAsyncProviders(
    options: RabbitMQModuleAsyncOptions,
  ): Provider[] {
    if (options.useFactory) {
      return [
        {
          provide: RABBITMQ_MODULE_OPTIONS,
          useFactory: options.useFactory,
          inject: options.inject || [],
        },
      ];
    }

    if (options.useClass) {
      return [
        {
          provide: RABBITMQ_MODULE_OPTIONS,
          useFactory: async (optionsFactory: RabbitMQOptionsFactory) =>
            optionsFactory.createRabbitMQOptions(),
          inject: [options.useClass],
        },
        {
          provide: options.useClass,
          useClass: options.useClass,
        },
      ];
    }

    if (options.useExisting) {
      return [
        {
          provide: RABBITMQ_MODULE_OPTIONS,
          useFactory: async (optionsFactory: RabbitMQOptionsFactory) =>
            optionsFactory.createRabbitMQOptions(),
          inject: [options.useExisting],
        },
      ];
    }

    return [];
  }
}
