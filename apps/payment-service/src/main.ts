import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { join } from 'path';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const grpcPort = process.env.PAYMENT_SERVICE_GRPC_PORT || '50054';
  const httpPort = process.env.PAYMENT_SERVICE_HTTP_PORT || '3004';

  // Connect gRPC Microservice
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.GRPC,
    options: {
      package: 'payment',
      protoPath: join(process.cwd(), 'libs/shared/protos/payment.proto'),
      url: `0.0.0.0:${grpcPort}`,
    },
  });

  // Connect RabbitMQ Microservice
  if (process.env.RABBITMQ_URI) {
    app.connectMicroservice<MicroserviceOptions>({
      transport: Transport.RMQ,
      options: {
        urls: [process.env.RABBITMQ_URI],
        queue: process.env.RABBITMQ_PAYMENT_QUEUE || 'payment_queue',
        queueOptions: {
          durable: true,
        },
      },
    });
  }

  await app.startAllMicroservices();
  await app.listen(httpPort);

  Logger.log(`🚀 Payment Service HTTP running on port ${httpPort}`);
  Logger.log(`⚡ Payment Service gRPC listening on port ${grpcPort}`);
}

bootstrap();
