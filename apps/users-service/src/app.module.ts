import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', 'apps/users-service/.env'],
    }),
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
