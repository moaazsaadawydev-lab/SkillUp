import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from './user.entity';

@Entity('email_changes_history')
export class EmailChangeHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_email_changes_history_user_id')
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, (user) => user.emailChanges, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'old_email', type: 'varchar', length: 255 })
  oldEmail: string;

  @Column({ name: 'current_email', type: 'varchar', length: 255 })
  currentEmail: string;

  @CreateDateColumn({
    name: 'changed_at',
    type: 'timestamptz',
    default: () => 'CURRENT_TIMESTAMP',
  })
  changedAt: Date;

  @Column({ name: 'expire_at', type: 'timestamptz', nullable: true })
  expireAt: Date | null;
}
