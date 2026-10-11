import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { UsersModule } from './users/users.module';
import { MediaModule } from './media/media.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', 'apps/api-gateway/.env'],
    }),
    UsersModule,
    MediaModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
