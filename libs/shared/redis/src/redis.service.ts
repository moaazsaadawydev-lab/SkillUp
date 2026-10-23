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
   * Execute raw Redis Lua scripts atomically
   */
  async eval(
    script: string,
    numKeys: number,
    ...args: (string | number)[]
  ): Promise<any> {
    return this.client.eval(script, numKeys, ...args);
  }

  /**
   * Atomic session management executing Redis Lua script:
   * 1. Save session hash (session:{sessionId}) with TTL (default 7 days).
   * 2. Add sessionId to user sessions ZSet (user_sessions:{userId}).
   * 3. Evict excess sessions beyond maxDevices (default 5) in a single roundtrip.
   */
  async saveSessionWithEviction(params: {
    sessionId: string;
    userId: string;
    hashedRefreshToken: string;
    ipAddress: string;
    userAgent: string;
    createdAt?: string;
    maxDevices?: number;
    ttlSeconds?: number;
  }): Promise<number> {
    const {
      sessionId,
      userId,
      hashedRefreshToken,
      ipAddress,
      userAgent,
      createdAt = new Date().toISOString(),
      maxDevices = 5,
      ttlSeconds = 7 * 24 * 60 * 60, // 604800 = 7 days
    } = params;

    const sessionKey = `session:${sessionId}`;
    const userSessionsKey = `user_sessions:${userId}`;
    const score = Date.now();

    const luaScript = `
-- KEYS[1]: sessionKey ("session:" .. sessionId)
-- KEYS[2]: userSessionsKey ("user_sessions:" .. userId)
-- ARGV[1]: userId
-- ARGV[2]: hashedRefreshToken
-- ARGV[3]: ipAddress
-- ARGV[4]: userAgent
-- ARGV[5]: createdAt
-- ARGV[6]: score (current timestamp ms)
-- ARGV[7]: ttlSeconds (604800 = 7 days)
-- ARGV[8]: maxDevices (5)
-- ARGV[9]: sessionId

-- 1. Save session hash
redis.call('HSET', KEYS[1], 
  'userId', ARGV[1], 
  'hashedRefreshToken', ARGV[2], 
  'ipAddress', ARGV[3], 
  'userAgent', ARGV[4], 
  'createdAt', ARGV[5]
)
redis.call('EXPIRE', KEYS[1], ARGV[7])

-- 2. Add to user sessions ZSet
redis.call('ZADD', KEYS[2], ARGV[6], ARGV[9])
redis.call('EXPIRE', KEYS[2], ARGV[7])

-- 3. Evict excess sessions beyond maxDevices (rank 0 to -(maxDevices + 1))
local totalSessions = redis.call('ZCARD', KEYS[2])
local maxAllowed = tonumber(ARGV[8])

if totalSessions > maxAllowed then
  local excessCount = totalSessions - maxAllowed
  -- Get oldest sessions to delete
  local staleSessions = redis.call('ZRANGE', KEYS[2], 0, excessCount - 1)
  for _, sid in ipairs(staleSessions) do
    redis.call('DEL', 'session:' .. sid)
  end
  redis.call('ZREMRANGEBYRANK', KEYS[2], 0, excessCount - 1)
end

return 1
    `;

    return this.eval(
      luaScript,
      2,
      sessionKey,
      userSessionsKey,
      userId,
      hashedRefreshToken,
      ipAddress,
      userAgent,
      createdAt,
      score,
      ttlSeconds,
      maxDevices,
      sessionId,
    );
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

  async zremRangeByRank(
    key: string,
    start: number,
    stop: number,
  ): Promise<number> {
    return this.client.zremrangebyrank(key, start, stop);
  }

  // ===========================================================================
  // Hash Operations
  // ===========================================================================

  async hset(
    key: string,
    data: Record<string, string | number>,
  ): Promise<number> {
    return this.client.hset(key, data);
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    return this.client.hgetall(key);
  }

  async incr(key: string): Promise<number> {
    return this.client.incr(key);
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
