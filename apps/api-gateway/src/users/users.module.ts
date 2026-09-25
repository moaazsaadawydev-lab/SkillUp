import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import { join } from 'path';
import { existsSync } from 'fs';
import {
  USERS_PACKAGE_NAME,
  USERS_SERVICE_NAME,
} from '@skillup/shared/interfaces';
import { StorageModule } from '../storage/storage.module';
import { AuthController } from './auth.controller';

@Module({
  imports: [
    StorageModule,
    ClientsModule.registerAsync([
      {
        name: USERS_SERVICE_NAME,
        inject: [ConfigService],
        useFactory: (config: ConfigService) => {
          const protoPath = [
            join(process.cwd(), 'libs/shared/protos/users.proto'),
            join(process.cwd(), 'libs/shared/src/proto/users.proto'),
            join(__dirname, '../../../../libs/shared/protos/users.proto'),
          ].find((p) => existsSync(p)) || join(process.cwd(), 'libs/shared/protos/users.proto');

          const grpcUrl =
            config.get<string>('USERS_SERVICE_GRPC_URL') ||
            `localhost:${config.get<number>('USERS_SERVICE_GRPC_PORT', 50051)}`;

          return {
            transport: Transport.GRPC,
            options: {
              package: USERS_PACKAGE_NAME,
              protoPath,
              url: grpcUrl,
            },
          };
        },
      },
    ]),
  ],
  controllers: [AuthController],
  exports: [ClientsModule],
})
export class UsersModule {}
