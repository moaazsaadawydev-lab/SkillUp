import { LogLevel, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { join } from 'path';
import { AppModule } from './app.module';

async function bootstrap() {
  const isProd = process.env.NODE_ENV === 'production';
  const isDebug = process.env.LOG_LEVEL === 'debug' || !isProd;
  const logLevels: LogLevel[] = isDebug
    ? ['log', 'error', 'warn', 'debug', 'verbose']
    : ['log', 'error', 'warn'];

  const app = await NestFactory.create(AppModule, { logger: logLevels });
  const grpcPort = process.env.CATALOG_SERVICE_GRPC_PORT || '50052';
  const httpPort = process.env.CATALOG_SERVICE_HTTP_PORT || '3002';

  // Connect gRPC Microservice
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.GRPC,
    options: {
      package: 'catalog',
      protoPath: join(process.cwd(), 'libs/shared/protos/catalog.proto'),
      url: `0.0.0.0:${grpcPort}`,
    },
  });

  // Connect RabbitMQ Microservice
  if (process.env.RABBITMQ_URI) {
    app.connectMicroservice<MicroserviceOptions>({
      transport: Transport.RMQ,
      options: {
        urls: [process.env.RABBITMQ_URI],
        queue: process.env.RABBITMQ_CATALOG_QUEUE || 'catalog_queue',
        queueOptions: {
          durable: true,
        },
      },
    });
  }

  await app.startAllMicroservices();
  await app.listen(httpPort);

  Logger.log(`🚀 Catalog Service HTTP running on port ${httpPort}`);
  Logger.log(`⚡ Catalog Service gRPC listening on port ${grpcPort}`);
}

bootstrap();
