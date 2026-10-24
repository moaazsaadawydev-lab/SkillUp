import { Logger } from '@nestjs/common';
import { AppDataSource } from './data-source';

const logger = new Logger('SyncSchema');

async function sync() {
  logger.log('Connecting to PostgreSQL database...');
  await AppDataSource.initialize();
  logger.log(
    `Connected to: ${AppDataSource.options.database} on port ${
      (AppDataSource.options as any).port
    }`,
  );

  logger.log('Running pending database migrations...');
  await AppDataSource.runMigrations();
  logger.log('Database migrations executed successfully!');

  const queryRunner = AppDataSource.createQueryRunner();
  const tables = await queryRunner.getTables([
    'users',
    'email_changes_history',
    'outbox_messages',
  ]);
  logger.log('Verified tables in database:');
  for (const table of tables) {
    logger.log(` - ${table.name} (${table.columns.length} columns)`);
  }

  await AppDataSource.destroy();
}

sync().catch((err) => {
  logger.error('Schema sync failed:', err);
  process.exit(1);
});
