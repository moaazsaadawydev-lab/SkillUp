import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { join } from 'path';
import { existsSync } from 'fs';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Configuration values with sensible defaults
  const grpcUrl =
    process.env.GRPC_USERS_URL ||
    `0.0.0.0:${process.env.USERS_SERVICE_GRPC_PORT || '50051'}`;
  const httpPort = process.env.USERS_SERVICE_HTTP_PORT || '3001';

  // Locate proto file with multiple fallback paths
  const protoPath = [
    join(process.cwd(), 'libs/shared/src/proto/users.proto'),
    join(process.cwd(), 'libs/shared/protos/users.proto'),
    join(__dirname, '../../../libs/shared/src/proto/users.proto'),
    join(__dirname, '../../../libs/shared/protos/users.proto'),
  ].find((path) => existsSync(path)) || join(process.cwd(), 'libs/shared/protos/users.proto');

  // Connect gRPC Microservice
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.GRPC,
    options: {
      package: 'users',
      protoPath,
      url: grpcUrl,
    },
  });

  // Connect RabbitMQ Microservice (if configured)
  if (process.env.RABBITMQ_URI) {
    app.connectMicroservice<MicroserviceOptions>({
      transport: Transport.RMQ,
      options: {
        urls: [process.env.RABBITMQ_URI],
        queue: process.env.RABBITMQ_USERS_QUEUE || 'users_queue',
        queueOptions: {
          durable: true,
        },
      },
    });
  }

  await app.startAllMicroservices();
  await app.listen(httpPort);

  Logger.log(`🚀 Users Service HTTP running on port: ${httpPort}`);
  Logger.log(`⚡ Users Service gRPC listening on: ${grpcUrl}`);
  Logger.log(`📄 Using Proto definition from: ${protoPath}`);
}

bootstrap();
