import { ExecutionContext } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { status } from '@grpc/grpc-js';

/**
 * In-memory Mock Redis implementation simulating ioredis commands,
 * hashes, sorted sets, key expiration (TTLs), and Lua script execution.
 */
export class MockRedis {
  private store = new Map<string, string>();
  private ttls = new Map<string, number>();
  private hashes = new Map<string, Map<string, string>>();
  private zsets = new Map<string, Map<string, number>>();

  async get(key: string): Promise<string | null> {
    if (this.isExpired(key)) {
      this.del(key);
      return null;
    }
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: string | number, mode?: string, duration?: number): Promise<'OK'> {
    this.store.set(key, value.toString());
    if (mode === 'EX' && duration) {
      this.ttls.set(key, Date.now() + duration * 1000);
    } else {
      this.ttls.delete(key);
    }
    return 'OK';
  }

  async setWithTtl(key: string, value: string | number, ttlSeconds: number): Promise<'OK'> {
    return this.set(key, value, 'EX', ttlSeconds);
  }

  async del(key: string): Promise<number> {
    let deleted = 0;
    if (this.store.delete(key)) deleted = 1;
    this.ttls.delete(key);
    this.hashes.delete(key);
    this.zsets.delete(key);
    return deleted;
  }

  async exists(key: string): Promise<number> {
    if (this.isExpired(key)) {
      this.del(key);
      return 0;
    }
    return this.store.has(key) || this.hashes.has(key) || this.zsets.has(key) ? 1 : 0;
  }

  async expire(key: string, seconds: number): Promise<number> {
    if (this.store.has(key) || this.hashes.has(key) || this.zsets.has(key)) {
      this.ttls.set(key, Date.now() + seconds * 1000);
      return 1;
    }
    return 0;
  }

  async ttl(key: string): Promise<number> {
    if (this.isExpired(key)) {
      this.del(key);
      return -2;
    }
    const expiresAt = this.ttls.get(key);
    if (!expiresAt) return -1;
    const remaining = Math.ceil((expiresAt - Date.now()) / 1000);
    return remaining > 0 ? remaining : -2;
  }

  async incr(key: string): Promise<number> {
    const val = await this.get(key);
    const num = val ? parseInt(val, 10) + 1 : 1;
    this.store.set(key, num.toString());
    return num;
  }

  // Hash Operations
  async hset(key: string, data: Record<string, any>): Promise<number> {
    let map = this.hashes.get(key);
    if (!map) {
      map = new Map<string, string>();
      this.hashes.set(key, map);
    }
    let count = 0;
    for (const [f, v] of Object.entries(data)) {
      map.set(f, typeof v === 'object' ? JSON.stringify(v) : String(v));
      count++;
    }
    return count;
  }

  async hget(key: string, field: string): Promise<string | null> {
    const map = this.hashes.get(key);
    return map?.get(field) ?? null;
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    const map = this.hashes.get(key);
    if (!map) return {};
    const obj: Record<string, string> = {};
    for (const [k, v] of map.entries()) {
      obj[k] = v;
    }
    return obj;
  }

  // Sorted Set Operations
  async zadd(key: string, score: number, member: string): Promise<number> {
    let zset = this.zsets.get(key);
    if (!zset) {
      zset = new Map<string, number>();
      this.zsets.set(key, zset);
    }
    zset.set(member, score);
    return 1;
  }

  async zrange(key: string, start: number, stop: number): Promise<string[]> {
    const zset = this.zsets.get(key);
    if (!zset) return [];
    const sorted = Array.from(zset.entries())
      .sort((a, b) => a[1] - b[1])
      .map(([m]) => m);

    const len = sorted.length;
    const s = start < 0 ? Math.max(0, len + start) : start;
    const e = stop < 0 ? Math.max(0, len + stop + 1) : stop + 1;
    return sorted.slice(s, e);
  }

  async zremRangeByRank(key: string, start: number, stop: number): Promise<number> {
    const items = await this.zrange(key, start, stop);
    const zset = this.zsets.get(key);
    if (!zset) return 0;
    for (const item of items) {
      zset.delete(item);
    }
    return items.length;
  }

  // Lua Script Evaluation Simulation
  async eval(script: string, numKeys: number, key: string, arg1?: string): Promise<number> {
    if (script.includes('INCR')) {
      const current = await this.incr(key);
      const ttlSec = arg1 ? parseInt(arg1, 10) : 900;
      if (current === 1) {
        await this.expire(key, ttlSec);
      } else {
        const remaining = await this.ttl(key);
        if (remaining === -1) {
          await this.expire(key, ttlSec);
        }
      }
      return current;
    }
    return 1;
  }

  getClient() {
    return this;
  }

  private isExpired(key: string): boolean {
    const expiresAt = this.ttls.get(key);
    if (!expiresAt) return false;
    return Date.now() > expiresAt;
  }

  clear() {
    this.store.clear();
    this.ttls.clear();
    this.hashes.clear();
    this.zsets.clear();
  }
}

/**
 * Creates mock gRPC UsersServiceClient
 */
export function createMockUsersServiceClient() {
  return {
    createUser: jest.fn().mockImplementation((payload) =>
      of({
        success: true,
        message: 'Verification code sent to your email',
        userId: payload.id || 'mock-user-uuid-1234',
      }),
    ),
    verifyAccount: jest.fn().mockImplementation((payload) =>
      of({
        success: true,
        message: 'Account verified successfully',
        data: {
          accessToken: 'mock-jwt-access-token-xyz',
          refreshToken: 'mock-refresh-token-hex',
          user: {
            id: 'mock-user-uuid-1234',
            email: payload.email,
            username: 'mockuser',
            role: 'STUDENT',
            status: 'ACTIVE',
            profilePhoto: '',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        },
      }),
    ),
    sendVerificationCode: jest.fn().mockImplementation(() =>
      of({
        success: true,
        message: 'A new verification code has been sent to your email address.',
      }),
    ),
  };
}

/**
 * Creates mock gRPC MediaServiceClient
 */
export function createMockMediaServiceClient() {
  return {
    getPresignedUploadUrl: jest.fn().mockImplementation((payload) =>
      of({
        success: true,
        message: 'Presigned upload URL generated successfully',
        uploadUrl: `http://localhost:9000/skillhub-media/temp_uploads/avatars/uuid_${payload.filename}?signed=true`,
        fileKey: `temp_uploads/avatars/uuid_${payload.filename}`,
        expiresIn: 120,
      }),
    ),
    checkFileExists: jest.fn().mockImplementation((payload) =>
      of({
        exists: true,
        fileSize: 1024 * 50, // 50 KB
        contentType: 'image/jpeg',
      }),
    ),
    getFileUrl: jest.fn().mockImplementation((payload) =>
      of({
        url: `http://localhost:9000/skillhub-media/${payload.fileKey}`,
        expiresIn: 3600,
      }),
    ),
    deleteFile: jest.fn().mockImplementation(() =>
      of({
        success: true,
        message: 'File deleted successfully',
      }),
    ),
  };
}
