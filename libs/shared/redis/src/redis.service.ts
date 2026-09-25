import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis, { ChainableCommander } from 'ioredis';
import { REDIS_CLIENT } from './redis.constants';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {}

  /**
   * Return the underlying ioredis instance for direct access to full command suite
   */
  getClient(): Redis {
    return this.client;
  }

  /**
   * Create an atomic Pipeline command runner
   */
  pipeline(): ChainableCommander {
    return this.client.pipeline();
  }

  /**
   * Create an atomic Transaction (MULTI) command runner
   */
  multi(): ChainableCommander {
    return this.client.multi();
  }

  // ===========================================================================
  // Basic Key-Value Operations
  // ===========================================================================

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async getJson<T>(key: string): Promise<T | null> {
    const data = await this.client.get(key);
    if (!data) return null;
    try {
      return JSON.parse(data) as T;
    } catch (error) {
      this.logger.error(`Failed to parse JSON for key "${key}":`, error);
      return null;
    }
  }

  async set(key: string, value: string | number): Promise<'OK' | null> {
    return this.client.set(key, value);
  }

  async setWithTtl(
    key: string,
    value: string | number,
    ttlSeconds: number,
  ): Promise<'OK' | null> {
    return this.client.set(key, value, 'EX', ttlSeconds);
  }

  async setJson(
    key: string,
    value: unknown,
    ttlSeconds?: number,
  ): Promise<'OK' | null> {
    const serialized = JSON.stringify(value);
    if (ttlSeconds) {
      return this.client.set(key, serialized, 'EX', ttlSeconds);
    }
    return this.client.set(key, serialized);
  }

  async del(key: string): Promise<number> {
    return this.client.del(key);
  }

  async exists(key: string): Promise<number> {
    return this.client.exists(key);
  }

  async expire(key: string, seconds: number): Promise<number> {
    return this.client.expire(key, seconds);
  }

  async ttl(key: string): Promise<number> {
    return this.client.ttl(key);
  }

  // ===========================================================================
  // ZSET Operations (Sorted Sets for Session / Token Management)
  // ===========================================================================

  async zadd(
    key: string,
    score: number,
    member: string,
  ): Promise<number | string> {
    return this.client.zadd(key, score, member);
  }

  async zrange(key: string, start: number, stop: number): Promise<string[]> {
    return this.client.zrange(key, start, stop);
  }

  async zrangeByScore(
    key: string,
    min: number | string,
    max: number | string,
  ): Promise<string[]> {
    return this.client.zrangebyscore(key, min, max);
  }

  async zrem(key: string, ...members: string[]): Promise<number> {
    return this.client.zrem(key, ...members);
  }

  async zremRangeByScore(
    key: string,
    min: number | string,
    max: number | string,
  ): Promise<number> {
    return this.client.zremrangebyscore(key, min, max);
  }

  async zcard(key: string): Promise<number> {
    return this.client.zcard(key);
  }

  // ===========================================================================
  // Token Blacklist Operations
  // ===========================================================================

  /**
   * Set a token (JTI) into blacklist with expiration time matching remaining token TTL
   */
  async blacklistToken(jti: string, ttlSeconds: number): Promise<'OK' | null> {
    const key = `blacklist:${jti}`;
    return this.client.set(key, 'revoked', 'EX', ttlSeconds);
  }

  /**
   * Check whether a token (JTI) is currently revoked / blacklisted
   */
  async isTokenBlacklisted(jti: string): Promise<boolean> {
    const key = `blacklist:${jti}`;
    const result = await this.client.exists(key);
    return result === 1;
  }

  // ===========================================================================
  // Lifecycle Hook
  // ===========================================================================

  async onModuleDestroy(): Promise<void> {
    try {
      this.logger.log('Gracefully closing Redis connection...');
      await this.client.quit();
    } catch (error) {
      this.logger.warn(
        `Error during Redis graceful quit, forcing disconnect: ${error instanceof Error ? error.message : error}`,
      );
      this.client.disconnect();
    }
  }
}
