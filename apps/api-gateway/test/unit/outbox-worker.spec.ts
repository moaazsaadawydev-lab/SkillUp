import { OutboxWorker } from '../../../../apps/users-service/src/outbox/outbox.worker';
import { OutboxMessage } from '@skillup/shared/entities';
import { OutboxStatus } from '@skillup/shared/enums';
import { OUTBOX_EVENTS, RABBITMQ_ROUTING_KEYS } from '@skillup/shared/constants';

describe('Unit Tests: OutboxWorker Redaction & Pruning', () => {
  let worker: OutboxWorker;
  let mockDataSource: any;
  let mockEventPublisher: any;
  let mockQueryRunner: any;
  let mockQueryBuilder: any;

  beforeEach(() => {
    mockQueryBuilder = {
      setLock: jest.fn().mockReturnThis(),
      setOnLocked: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn(),
      delete: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 2, raw: [] }),
    };

    mockQueryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      manager: {
        createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
        save: jest.fn().mockImplementation((entity) => Promise.resolve(entity)),
      },
    };

    mockDataSource = {
      createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner),
      createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
    };

    mockEventPublisher = {
      publishEvent: jest.fn().mockResolvedValue(true),
    };

    worker = new OutboxWorker(mockDataSource, mockEventPublisher);
  });

  describe('Immediate In-Place Redaction', () => {
    it('should deliver genuine OTP to RabbitMQ and redact code in database before saving PUBLISHED state', async () => {
      const rawOtpCode = '849201';
      const pendingMessage: any = {
        id: 'msg-uuid-1',
        eventType: OUTBOX_EVENTS.SEND_VERIFICATION_EMAIL,
        payload: {
          email: 'student@skillup.com',
          code: rawOtpCode,
          username: 'student1',
        },
        status: OutboxStatus.PENDING,
        retryCount: 0,
        createdAt: new Date(),
        processedAt: null,
      };

      mockQueryBuilder.getMany.mockResolvedValue([pendingMessage]);

      await worker.processOutboxMessages();

      // 1. Verify EventPublisher received the genuine unredacted OTP
      expect(mockEventPublisher.publishEvent).toHaveBeenCalledTimes(1);
      expect(mockEventPublisher.publishEvent).toHaveBeenCalledWith(
        RABBITMQ_ROUTING_KEYS.VERIFICATION_EMAIL,
        expect.objectContaining({
          email: 'student@skillup.com',
          code: rawOtpCode,
          username: 'student1',
        }),
        expect.objectContaining({
          messageId: 'msg-uuid-1',
          headers: { eventType: OUTBOX_EVENTS.SEND_VERIFICATION_EMAIL },
        }),
      );

      // 2. Verify Database received the sanitized [REDACTED] code upon save
      expect(mockQueryRunner.manager.save).toHaveBeenCalledTimes(1);
      const savedEntity = mockQueryRunner.manager.save.mock.calls[0][0];

      expect(savedEntity.status).toBe(OutboxStatus.PUBLISHED);
      expect(savedEntity.processedAt).toBeInstanceOf(Date);
      expect(savedEntity.payload.code).toBe('[REDACTED]');
      expect(savedEntity.payload.email).toBe('student@skillup.com');
      expect(savedEntity.payload.username).toBe('student1');

      // 3. Verify transaction commit & release
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalledTimes(1);
      expect(mockQueryRunner.release).toHaveBeenCalledTimes(1);
    });

    it('should not redact payload if no code field exists (e.g. photo processing events)', async () => {
      const photoMessage: any = {
        id: 'msg-uuid-2',
        eventType: OUTBOX_EVENTS.PROCESS_PROFILE_PHOTO,
        payload: {
          userId: 'user-123',
          tempKey: 'temp/photo.png',
          targetKey: 'avatars/photo.webp',
        },
        status: OutboxStatus.PENDING,
        retryCount: 0,
        createdAt: new Date(),
        processedAt: null,
      };

      mockQueryBuilder.getMany.mockResolvedValue([photoMessage]);

      await worker.processOutboxMessages();

      expect(mockEventPublisher.publishEvent).toHaveBeenCalledWith(
        RABBITMQ_ROUTING_KEYS.PROCESS_PHOTO,
        photoMessage.payload,
        expect.anything(),
      );

      const savedEntity = mockQueryRunner.manager.save.mock.calls[0][0];
      expect(savedEntity.status).toBe(OutboxStatus.PUBLISHED);
      expect(savedEntity.payload).toEqual({
        userId: 'user-123',
        tempKey: 'temp/photo.png',
        targetKey: 'avatars/photo.webp',
      });
    });
  });

  describe('Automated Housekeeping (Retention Pruning Cron)', () => {
    it('should successfully prune published messages older than 1 hour', async () => {
      mockQueryBuilder.execute.mockResolvedValue({ affected: 5, raw: [] });

      await worker.prunePublishedMessages();

      expect(mockDataSource.createQueryBuilder).toHaveBeenCalledTimes(1);
      expect(mockQueryBuilder.delete).toHaveBeenCalledTimes(1);
      expect(mockQueryBuilder.from).toHaveBeenCalledWith(OutboxMessage);
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        expect.stringContaining('status = :status'),
        expect.objectContaining({
          status: OutboxStatus.PUBLISHED,
          cutoff: expect.any(Date),
        }),
      );
      expect(mockQueryBuilder.execute).toHaveBeenCalledTimes(1);
    });

    it('should handle pruning database errors gracefully without throwing', async () => {
      mockQueryBuilder.execute.mockRejectedValue(new Error('Connection lost'));

      await expect(worker.prunePublishedMessages()).resolves.not.toThrow();
    });
  });
});
