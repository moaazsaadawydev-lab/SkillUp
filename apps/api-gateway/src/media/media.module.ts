import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import { join } from 'path';
import { existsSync } from 'fs';
import {
  MEDIA_PACKAGE_NAME,
  MEDIA_SERVICE_NAME,
} from '@skillup/shared/interfaces';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { UploadUrlProvider, FileQueryProvider } from './providers';

@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: MEDIA_SERVICE_NAME,
        inject: [ConfigService],
        useFactory: (config: ConfigService) => {
          const protoPath = [
            join(process.cwd(), 'libs/shared/protos/media.proto'),
            join(process.cwd(), 'libs/shared/src/proto/media.proto'),
            join(__dirname, '../../../../libs/shared/protos/media.proto'),
          ].find((p) => existsSync(p)) ||
            join(process.cwd(), 'libs/shared/protos/media.proto');

          const grpcUrl =
            config.get<string>('MEDIA_SERVICE_GRPC_URL') ||
            `localhost:${config.get<number>('MEDIA_SERVICE_GRPC_PORT', 50056)}`;

          return {
            transport: Transport.GRPC,
            options: {
              package: MEDIA_PACKAGE_NAME,
              protoPath,
              url: grpcUrl,
            },
          };
        },
      },
    ]),
  ],
  controllers: [MediaController],
  providers: [MediaService, UploadUrlProvider, FileQueryProvider],
  exports: [ClientsModule, MediaService, UploadUrlProvider, FileQueryProvider],
})
export class MediaModule {}
