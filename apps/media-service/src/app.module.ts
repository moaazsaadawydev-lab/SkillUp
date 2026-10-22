import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { RabbitMQModule } from '@skillup/shared/rabbitmq';
import { RedisModule } from '@skillup/shared/redis';
import { StorageModule } from './storage/storage.module';
import { ImageProcessorService } from './processors/image-processor.service';
import { MediaConsumerService } from './consumers/media-consumer.service';
import { MediaService } from './media.service';
import { MediaGrpcController } from './media-grpc.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['apps/media-service/.env', '.env'],
    }),
    ScheduleModule.forRoot(),
    RedisModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        host: config.get<string>('REDIS_HOST', 'localhost'),
        port: Number(config.get<number>('REDIS_PORT', 6379)),
        password: config.get<string>('REDIS_PASSWORD', undefined),
      }),
    }),
    RabbitMQModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        urls: [
          config.get<string>('RABBITMQ_URI') ||
            config.get<string>(
              'RABBITMQ_URL',
              'amqp://guest:guest@localhost:5672',
            ),
        ],
        defaultExchange: config.get<string>(
          'RABBITMQ_DEFAULT_EXCHANGE',
          'skillhub.events',
        ),
        exchangeType: 'topic',
      }),
    }),
    StorageModule,
  ],
  controllers: [MediaGrpcController],
  providers: [MediaService, ImageProcessorService, MediaConsumerService],
  exports: [MediaService],
})
export class AppModule {}
