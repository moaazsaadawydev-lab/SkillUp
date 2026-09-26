import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RabbitMQModule } from '@skillup/shared/rabbitmq';
import { MailModule } from './mail/mail.module';
import { NotificationConsumerService } from './consumers/notification-consumer.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['apps/notifications-service/.env', '.env'],
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
    MailModule,
  ],
  controllers: [],
  providers: [NotificationConsumerService],
})
export class AppModule {}
