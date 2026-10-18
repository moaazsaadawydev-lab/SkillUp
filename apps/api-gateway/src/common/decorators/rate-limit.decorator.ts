import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_KEY = 'RATE_LIMIT_OPTIONS';

export interface RateLimitOptions {
  /**
   * Maximum number of requests allowed within the TTL window.
   */
  limit: number;

  /**
   * Time-to-live window in seconds (e.g., 900 for 15 minutes).
   */
  ttl: number;

  /**
   * Category/Prefix for the Redis key namespace (e.g., 'register', 'avatar-upload').
   */
  prefix?: string;
}

/**
 * Decorator to apply IP-based rate limiting to controllers or individual endpoints.
 * Example: @RateLimit({ limit: 5, ttl: 900, prefix: 'register' })
 */
export const RateLimit = (options: RateLimitOptions) =>
  SetMetadata(RATE_LIMIT_KEY, options);
