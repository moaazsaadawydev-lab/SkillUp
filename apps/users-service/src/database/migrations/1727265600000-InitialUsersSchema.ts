import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialUsersSchema1727265600000 implements MigrationInterface {
  name = 'InitialUsersSchema1727265600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Ensure pgcrypto or uuid-ossp extension is enabled for UUID generation
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);

    // 2. Create ENUM types
    await queryRunner.query(
      `DO $$ BEGIN
        CREATE TYPE "users_role_enum" AS ENUM ('STUDENT', 'INSTRUCTOR', 'ADMIN');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;`
    );

    await queryRunner.query(
      `DO $$ BEGIN
        CREATE TYPE "users_status_enum" AS ENUM ('PENDING', 'ACTIVE', 'BLOCKED');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;`
    );

    await queryRunner.query(
      `DO $$ BEGIN
        CREATE TYPE "outbox_messages_status_enum" AS ENUM ('PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;`
    );

    // 3. Create 'users' table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "users" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "username" character varying(50) NOT NULL,
        "email" character varying(255) NOT NULL,
        "password" character varying(255) NOT NULL,
        "role" "users_role_enum" NOT NULL DEFAULT 'STUDENT',
        "status" "users_status_enum" NOT NULL DEFAULT 'ACTIVE',
        "profile_photo" character varying(500),
        "birth_date" date,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "PK_users_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_users_username" UNIQUE ("username"),
        CONSTRAINT "UQ_users_email" UNIQUE ("email")
      );
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_users_username" ON "users" ("username");
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_users_email" ON "users" ("email");
    `);

    // 4. Create 'email_changes_history' table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "email_changes_history" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "old_email" character varying(255) NOT NULL,
        "current_email" character varying(255) NOT NULL,
        "changed_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "expire_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_email_changes_history_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_email_changes_history_user_id" FOREIGN KEY ("user_id") 
          REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_email_changes_history_user_id" 
      ON "email_changes_history" ("user_id");
    `);

    // 5. Create 'outbox_messages' table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "outbox_messages" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "event_type" character varying(100) NOT NULL,
        "payload" jsonb NOT NULL,
        "status" "outbox_messages_status_enum" NOT NULL DEFAULT 'PENDING',
        "retry_count" integer NOT NULL DEFAULT 0,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "processed_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_outbox_messages_id" PRIMARY KEY ("id")
      );
    `);

    // 6. Create high-performance partial index on outbox_messages
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_outbox_messages_status_pending_created_at" 
      ON "outbox_messages" ("created_at" ASC) 
      WHERE status = 'PENDING';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop in reverse order
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_outbox_messages_status_pending_created_at";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "outbox_messages";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "outbox_messages_status_enum";`);

    await queryRunner.query(`DROP INDEX IF EXISTS "idx_email_changes_history_user_id";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "email_changes_history";`);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_users_email";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_users_username";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "users";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "users_status_enum";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "users_role_enum";`);
  }
}
