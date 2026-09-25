import { ModuleMetadata, Type } from '@nestjs/common';
import { Options } from 'amqplib';

export interface RabbitMQModuleOptions {
  urls: string | string[];
  defaultExchange?: string;
  exchangeType?: 'topic' | 'direct' | 'fanout' | 'headers';
  connectionName?: string;
  heartbeatIntervalInSeconds?: number;
  reconnectTimeInSeconds?: number;
}

export interface RabbitMQOptionsFactory {
  createRabbitMQOptions():
    | Promise<RabbitMQModuleOptions>
    | RabbitMQModuleOptions;
}

export interface RabbitMQModuleAsyncOptions
  extends Pick<ModuleMetadata, 'imports'> {
  inject?: any[];
  useExisting?: Type<RabbitMQOptionsFactory>;
  useClass?: Type<RabbitMQOptionsFactory>;
  useFactory?: (
    ...args: any[]
  ) => Promise<RabbitMQModuleOptions> | RabbitMQModuleOptions;
}

export interface PublishEventOptions extends Options.Publish {
  exchange?: string;
  headers?: Record<string, any>;
  correlationId?: string;
  messageId?: string;
}
