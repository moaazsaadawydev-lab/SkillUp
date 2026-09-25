import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { UsersGrpcController } from './users-grpc.controller';
import { UsersService } from './users.service';
import { OutboxModule } from './outbox/outbox.module';
import { RedisModule } from '@skillup/shared/redis';
import { RabbitMQModule } from '@skillup/shared/rabbitmq';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['apps/users-service/.env', '.env'],
    }),
    DatabaseModule,
    RedisModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        host: config.get<string>('REDIS_HOST', 'localhost'),
        port: Number(config.get<number>('REDIS_PORT', 6379)),
        password: config.get<string>('REDIS_PASSWORD') || undefined,
      }),
    }),
    RabbitMQModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        urls: [
          config.get<string>('RABBITMQ_URI') ||
            config.get<string>('RABBITMQ_URL', 'amqp://guest:guest@localhost:5672'),
        ],
        defaultExchange: config.get<string>(
          'RABBITMQ_DEFAULT_EXCHANGE',
          'skillhub.events',
        ),
        exchangeType: 'topic',
      }),
    }),
    OutboxModule,
  ],
  controllers: [UsersGrpcController],
  providers: [UsersService],
})
export class AppModule {}
