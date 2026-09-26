import { AppDataSource } from './data-source';

async function sync() {
  console.log('Connecting to PostgreSQL database...');
  await AppDataSource.initialize();
  console.log(`Connected to: ${AppDataSource.options.database} on port ${(AppDataSource.options as any).port}`);
  
  console.log('Synchronizing schema (creating tables and constraints)...');
  await AppDataSource.synchronize(false);
  console.log('Schema synchronized successfully!');

  const queryRunner = AppDataSource.createQueryRunner();
  const tables = await queryRunner.getTables([
    'users',
    'email_changes_history',
    'outbox_messages',
  ]);
  console.log('Verified tables in database:');
  for (const table of tables) {
    console.log(` - ${table.name} (${table.columns.length} columns)`);
  }

  await AppDataSource.destroy();
}

sync().catch((err) => {
  console.error('Schema sync failed:', err);
  process.exit(1);
});
