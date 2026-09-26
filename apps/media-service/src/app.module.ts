import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RabbitMQModule } from '@skillup/shared/rabbitmq';
import { StorageModule } from './storage/storage.module';
import { ImageProcessorService } from './processors/image-processor.service';
import { MediaConsumerService } from './consumers/media-consumer.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['apps/media-service/.env', '.env'],
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
  controllers: [],
  providers: [ImageProcessorService, MediaConsumerService],
})
export class AppModule {}
