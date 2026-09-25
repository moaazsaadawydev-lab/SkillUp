import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { OutboxMessage } from '@skillup/shared/entities';
import { OutboxStatus } from '@skillup/shared/enums';
import { EventPublisherService } from '@skillup/shared/rabbitmq';
import { OUTBOX_EVENTS, RABBITMQ_ROUTING_KEYS } from '@skillup/shared/constants';

@Injectable()
export class OutboxWorker {
  private readonly logger = new Logger(OutboxWorker.name);
  private isProcessing = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly eventPublisher: EventPublisherService,
  ) {}

  /**
   * Periodic cron execution every 10 seconds to process pending outbox events
   */
  @Cron('*/10 * * * * *')
  async handleCron(): Promise<void> {
    await this.processOutboxMessages();
  }

  /**
   * Immediate trigger invoked right after transaction commit
   */
  trigger(): void {
    setImmediate(async () => {
      try {
        await this.processOutboxMessages();
      } catch (error) {
        this.logger.error(
          'Error during outbox immediate trigger execution:',
          error instanceof Error ? error.stack : error,
        );
      }
    });
  }

  /**
   * Fetches and publishes pending outbox messages using SELECT ... FOR UPDATE SKIP LOCKED
   */
  async processOutboxMessages(): Promise<void> {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const pendingMessages = await queryRunner.manager
        .createQueryBuilder(OutboxMessage, 'outbox')
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .where('outbox.status = :status', { status: OutboxStatus.PENDING })
        .orderBy('outbox.createdAt', 'ASC')
        .take(50)
        .getMany();

      if (!pendingMessages || pendingMessages.length === 0) {
        await queryRunner.rollbackTransaction();
        return;
      }

      this.logger.debug(
        `Found ${pendingMessages.length} pending outbox messages to publish.`,
      );

      for (const msg of pendingMessages) {
        try {
          const routingKey = this.resolveRoutingKey(msg.eventType);

          await this.eventPublisher.publishEvent(routingKey, msg.payload, {
            messageId: msg.id,
            headers: {
              eventType: msg.eventType,
            },
          });

          msg.status = OutboxStatus.PUBLISHED;
          msg.processedAt = new Date();
          await queryRunner.manager.save(msg);

          this.logger.log(
            `[Outbox] Successfully published event ${msg.eventType} (ID: ${msg.id})`,
          );
        } catch (publishErr) {
          this.logger.error(
            `[Outbox] Failed to publish event ${msg.eventType} (ID: ${msg.id}):`,
            publishErr instanceof Error ? publishErr.stack : publishErr,
          );

          msg.retryCount += 1;
          if (msg.retryCount >= 5) {
            msg.status = OutboxStatus.FAILED;
            this.logger.warn(
              `[Outbox] Message ${msg.id} reached maximum retries (5) and was marked as FAILED`,
            );
          }
          await queryRunner.manager.save(msg);
        }
      }

      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(
        'Transaction failed during outbox processing:',
        error instanceof Error ? error.stack : error,
      );
    } finally {
      await queryRunner.release();
      this.isProcessing = false;
    }
  }

  private resolveRoutingKey(eventType: string): string {
    switch (eventType) {
      case OUTBOX_EVENTS.SEND_VERIFICATION_EMAIL:
        return RABBITMQ_ROUTING_KEYS.VERIFICATION_EMAIL;
      case OUTBOX_EVENTS.PROCESS_PROFILE_PHOTO:
        return RABBITMQ_ROUTING_KEYS.PROCESS_PHOTO;
      default:
        return `skillhub.event.${eventType.toLowerCase()}`;
    }
  }
}
