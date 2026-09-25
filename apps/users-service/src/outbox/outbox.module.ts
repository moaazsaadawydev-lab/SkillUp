import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { OutboxMessage } from '@skillup/shared/entities';
import { OutboxWorker } from './outbox.worker';

@Module({
  imports: [
    TypeOrmModule.forFeature([OutboxMessage]),
    ScheduleModule.forRoot(),
  ],
  providers: [OutboxWorker],
  exports: [OutboxWorker],
})
export class OutboxModule {}
