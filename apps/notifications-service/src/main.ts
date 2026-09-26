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
  const grpcPort = process.env.NOTIFICATIONS_SERVICE_GRPC_PORT || '50055';
  const httpPort = process.env.NOTIFICATIONS_SERVICE_HTTP_PORT || '3005';

  // Connect gRPC Microservice
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.GRPC,
    options: {
      package: 'notifications',
      protoPath: join(process.cwd(), 'libs/shared/protos/notifications.proto'),
      url: `0.0.0.0:${grpcPort}`,
    },
  });

  // RabbitMQ consumption is managed by NotificationConsumerService via RabbitMQModule

  await app.startAllMicroservices();
  await app.listen(httpPort);

  Logger.log(`🚀 Notifications Service HTTP running on port ${httpPort}`);
  Logger.log(`⚡ Notifications Service gRPC listening on port ${grpcPort}`);
}

bootstrap();
