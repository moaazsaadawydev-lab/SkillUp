import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
import { resolve } from 'path';
import { User, EmailChangeHistory, OutboxMessage } from '@skillup/shared/entities';

// Load workspace root .env first, then override with service-specific .env
dotenv.config({ path: resolve(process.cwd(), '.env') });
dotenv.config({ path: resolve(process.cwd(), 'apps/users-service/.env'), override: true });

const port = parseInt(
  process.env.POSTGRES_PORT ||
  process.env.POSTGRES_HOST_PORT ||
  '5433',
  10,
);

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.POSTGRES_HOST || 'localhost',
  port,
  username: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || 'postgres',
  database: process.env.POSTGRES_DB === 'skillhub_db' ? 'skillhub_users' : (process.env.POSTGRES_DB || 'skillhub_users'),
  entities: [User, EmailChangeHistory, OutboxMessage],
  migrations: [resolve(__dirname, 'migrations/*{.ts,.js}')],
  synchronize: true,
  logging: true,
});
