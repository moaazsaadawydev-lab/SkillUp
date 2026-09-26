import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { User, EmailChangeHistory, OutboxMessage } from '@skillup/shared/entities';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const configuredDb = configService.get<string>('POSTGRES_DB');
        const dbName = (!configuredDb || configuredDb === 'skillhub_db') ? 'skillhub_users' : configuredDb;
        return {
          type: 'postgres',
          host: configService.get<string>('POSTGRES_HOST', 'localhost'),
          port: Number(
            configService.get<number>('POSTGRES_PORT') ||
            configService.get<number>('POSTGRES_HOST_PORT') ||
            5433,
          ),
          username: configService.get<string>('POSTGRES_USER', 'postgres'),
          password: configService.get<string>('POSTGRES_PASSWORD', 'postgres'),
          database: dbName,
          entities: [User, EmailChangeHistory, OutboxMessage],
          synchronize: true, // Enabled for development schema synchronization
          logging: true,
        };
      },
    }),
    TypeOrmModule.forFeature([User, EmailChangeHistory, OutboxMessage]),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
