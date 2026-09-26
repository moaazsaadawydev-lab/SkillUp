import { LogLevel, Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { AllExceptionsFilter, LoggingInterceptor } from '@skillup/shared/common';

async function bootstrap() {
  const isProd = process.env.NODE_ENV === 'production';
  const isDebug = process.env.LOG_LEVEL === 'debug' || !isProd;
  const logLevels: LogLevel[] = isDebug
    ? ['log', 'error', 'warn', 'debug', 'verbose']
    : ['log', 'error', 'warn'];

  const app = await NestFactory.create(AppModule, { logger: logLevels });
  const configService = app.get(ConfigService);
  const port = configService.get<number>('API_GATEWAY_PORT', 3000);
  const globalPrefix = 'api/v1';

  app.setGlobalPrefix(globalPrefix);

  app.enableCors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  });

  app.use(cookieParser());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new LoggingInterceptor());

  await app.listen(port);
  Logger.log(
    `🚀 API Gateway is running on: http://localhost:${port}/${globalPrefix}`,
  );
}

bootstrap();
