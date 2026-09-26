import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConfirmChannel, ConsumeMessage } from 'amqplib';
import { ChannelWrapper, AmqpConnectionManager } from 'amqp-connection-manager';
import {
  RABBITMQ_CONNECTION,
  DEFAULT_EXCHANGE_NAME,
  DEFAULT_EXCHANGE_TYPE,
} from '@skillup/shared/rabbitmq';
import {
  OUTBOX_EVENTS,
  RABBITMQ_ROUTING_KEYS,
} from '@skillup/shared/constants';
import { MailService } from '../mail/mail.service';

export interface VerificationEmailPayload {
  email: string;
  code: string;
  username: string;
}

@Injectable()
export class NotificationConsumerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(NotificationConsumerService.name);
  private channelWrapper: ChannelWrapper;

  constructor(
    @Inject(RABBITMQ_CONNECTION)
    private readonly connectionManager: AmqpConnectionManager,
    private readonly configService: ConfigService,
    private readonly mailService: MailService,
  ) {}

  async onModuleInit(): Promise<void> {
    const queueName =
      this.configService.get<string>('RABBITMQ_NOTIFICATIONS_QUEUE') ||
      'notifications_queue';
    const exchangeName =
      this.configService.get<string>('RABBITMQ_DEFAULT_EXCHANGE') ||
      DEFAULT_EXCHANGE_NAME;

    const routingKey = RABBITMQ_ROUTING_KEYS.VERIFICATION_EMAIL;

    this.channelWrapper = this.connectionManager.createChannel({
      json: false,
      setup: async (channel: ConfirmChannel) => {
        this.logger.log(
          `Setting up RabbitMQ consumer: Queue="${queueName}", Exchange="${exchangeName}", RoutingKey="${routingKey}"`,
        );

        // Assert topic exchange
        await channel.assertExchange(exchangeName, DEFAULT_EXCHANGE_TYPE, {
          durable: true,
        });

        // Assert durable notifications queue
        await channel.assertQueue(queueName, {
          durable: true,
        });

        // Bind queue to exchange with routing patterns
        await channel.bindQueue(queueName, exchangeName, routingKey);
        await channel.bindQueue(queueName, exchangeName, 'notification.#');
        await channel.bindQueue(
          queueName,
          exchangeName,
          OUTBOX_EVENTS.SEND_VERIFICATION_EMAIL,
        );

        // Prefetch limit
        await channel.prefetch(2);

        // Start consuming messages
        await channel.consume(
          queueName,
          async (msg: ConsumeMessage | null) => {
            if (!msg) return;

            try {
              const content = msg.content.toString('utf-8');
              const payload = JSON.parse(content) as VerificationEmailPayload;

              this.logger.debug(
                `[RabbitMQ] Received verification email event for: ${payload.email} (MessageId: ${
                  msg.properties.messageId || 'no-id'
                })`,
              );

              // 1. Render template and send email
              await this.mailService.sendVerificationEmail(
                payload.email,
                payload.username,
                payload.code,
              );

              // 2. Acknowledge (ACK) the RabbitMQ message upon success
              channel.ack(msg);
              this.logger.debug(
                `[RabbitMQ] Successfully processed and ACKed message: ${
                  msg.properties.messageId || ''
                }`,
              );
            } catch (error) {
              this.logger.error(
                `[RabbitMQ] Failed to process verification email message ${
                  msg.properties.messageId || ''
                }:`,
                error instanceof Error ? error.stack : error,
              );

              // Reject and do not requeue poison pills to prevent infinite loops
              channel.nack(msg, false, false);
            }
          },
          { noAck: false },
        );

        this.logger.log(
          `RabbitMQ consumer successfully registered on queue: ${queueName}`,
        );
      },
    });

    this.channelWrapper.on('connect', () => {
      this.logger.log('NotificationConsumer channel connected.');
    });

    this.channelWrapper.on('error', (err) => {
      this.logger.error('NotificationConsumer channel error:', err);
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.channelWrapper) {
      try {
        await this.channelWrapper.close();
      } catch (err) {
        this.logger.warn(
          'Error closing NotificationConsumer channel:',
          err instanceof Error ? err.message : err,
        );
      }
    }
  }
}
