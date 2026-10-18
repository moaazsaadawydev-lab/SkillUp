import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { RedisModule } from '@skillup/shared/redis';
import { UsersModule } from './users/users.module';
import { MediaModule } from './media/media.module';
import { IpRateLimitGuard } from './common';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', 'apps/api-gateway/.env'],
    }),
    RedisModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        host: configService.get<string>('REDIS_HOST', 'localhost'),
        port: Number(configService.get<number>('REDIS_PORT', 6379)),
        password: configService.get<string>('REDIS_PASSWORD', undefined),
      }),
    }),
    UsersModule,
    MediaModule,
  ],
  controllers: [],
  providers: [
    {
      provide: APP_GUARD,
      useClass: IpRateLimitGuard,
    },
  ],
})
export class AppModule {}
