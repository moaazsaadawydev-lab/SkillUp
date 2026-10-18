import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import { RedisService } from '@skillup/shared/redis';
import {
  RATE_LIMIT_KEY,
  RateLimitOptions,
} from '../decorators/rate-limit.decorator';

@Injectable()
export class IpRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(IpRateLimitGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly redisService: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<RateLimitOptions>(
      RATE_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    );

    // If endpoint/controller is not decorated with @RateLimit, pass through immediately
    if (!options) {
      return true;
    }

    const httpContext = context.switchToHttp();
    const req = httpContext.getRequest<Request>();
    const res = httpContext.getResponse<Response>();

    // 1. Robust client IP resolution
    const clientIp = this.extractClientIp(req);
    const prefix = options.prefix || 'global';
    const redisKey = `ratelimit:${prefix}:ip:${clientIp}`;

    try {
      // 2. Atomic increment and expiration management via Redis Lua script
      const luaScript = `
        local current = redis.call('INCR', KEYS[1])
        if tonumber(current) == 1 then
          redis.call('EXPIRE', KEYS[1], ARGV[1])
        else
          local ttl = redis.call('TTL', KEYS[1])
          if ttl == -1 then
            redis.call('EXPIRE', KEYS[1], ARGV[1])
          end
        end
        return current
      `;

      const count = Number(
        await this.redisService.getClient().eval(
          luaScript,
          1,
          redisKey,
          options.ttl.toString(),
        ),
      );

      const remainingTtl = await this.redisService.ttl(redisKey);
      const effectiveTtl = remainingTtl > 0 ? remainingTtl : options.ttl;
      const remainingRequests = Math.max(0, options.limit - count);
      const resetTime = Math.ceil(Date.now() / 1000) + effectiveTtl;

      // 3. Attach standard rate-limiting headers (IETF draft standard)
      res.setHeader('X-RateLimit-Limit', options.limit.toString());
      res.setHeader('X-RateLimit-Remaining', remainingRequests.toString());
      res.setHeader('X-RateLimit-Reset', resetTime.toString());

      // 4. Threshold check
      if (count > options.limit) {
        res.setHeader('Retry-After', effectiveTtl.toString());
        this.logger.warn(
          `[RateLimit Blocked] IP: ${clientIp} exceeded limit (${count}/${options.limit}) for prefix "${prefix}". Retry-After: ${effectiveTtl}s`,
        );

        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            message: `Too many requests from this IP address. Please try again in ${Math.ceil(effectiveTtl / 60)} minutes.`,
            retryAfter: effectiveTtl,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      return true;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error(
        `Redis Rate Limiter check failed for IP ${clientIp}: ${error instanceof Error ? error.message : error}`,
      );
      // Fail-open: do not disrupt user traffic in the event of an unexpected Redis glitch
      return true;
    }
  }

  /**
   * Resolves client IP addressing reverse proxies, cloud load balancers, and IPv6 formatting.
   */
  private extractClientIp(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'];
    let clientIp: string | undefined;

    if (typeof forwarded === 'string') {
      clientIp = forwarded.split(',')[0].trim();
    } else if (Array.isArray(forwarded) && forwarded.length > 0) {
      clientIp = forwarded[0].trim();
    } else if (typeof req.headers['x-real-ip'] === 'string') {
      clientIp = req.headers['x-real-ip'].trim();
    } else {
      clientIp = req.ip || req.socket?.remoteAddress;
    }

    if (!clientIp) {
      clientIp = '127.0.0.1';
    }

    if (clientIp.startsWith('::ffff:')) {
      clientIp = clientIp.substring(7);
    }

    return clientIp;
  }
}
