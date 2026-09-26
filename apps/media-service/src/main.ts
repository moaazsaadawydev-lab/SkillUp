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
  const grpcPort = process.env.MEDIA_SERVICE_GRPC_PORT || '50056';
  const httpPort = process.env.MEDIA_SERVICE_HTTP_PORT || '3006';

  // Connect gRPC Microservice
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.GRPC,
    options: {
      package: 'media',
      protoPath: join(process.cwd(), 'libs/shared/protos/media.proto'),
      url: `0.0.0.0:${grpcPort}`,
    },
  });

  // RabbitMQ consumption is managed by MediaConsumerService via RabbitMQModule

  await app.startAllMicroservices();
  await app.listen(httpPort);

  Logger.log(`🚀 Media Service HTTP running on port ${httpPort}`);
  Logger.log(`⚡ Media Service gRPC listening on port ${grpcPort}`);
}

bootstrap();
