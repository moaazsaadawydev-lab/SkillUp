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
import * as crypto from 'crypto';
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

    // 1. Resolve safe client IP and construct Layer A (IP Rate Limit) key
    const clientIp = this.extractClientIp(req);
    const prefix = options.prefix || 'global';
    const ipKey = `ratelimit:${prefix}:ip:${clientIp}`;

    // 2. Construct Layer B (Email Rate Limit) key if an email is present in request body
    let emailKey: string | null = null;
    let emailHash: string | null = null;
    if (
      req.body &&
      typeof req.body.email === 'string' &&
      req.body.email.trim().length > 0
    ) {
      const normalizedEmail = req.body.email.trim().toLowerCase();
      emailHash = crypto
        .createHash('sha256')
        .update(normalizedEmail)
        .digest('hex')
        .substring(0, 16);
      emailKey = `ratelimit:${prefix}:email:${emailHash}`;
    }

    try {
      // 3. Atomic increment and expiration management via Redis Lua script
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

      // Execute Layer A (IP rate limit counter)
      const ipCount = Number(
        await this.redisService.getClient().eval(
          luaScript,
          1,
          ipKey,
          options.ttl.toString(),
        ),
      );
      const ipRemainingTtl = await this.redisService.ttl(ipKey);
      const ipEffectiveTtl = ipRemainingTtl > 0 ? ipRemainingTtl : options.ttl;
      const ipRemainingRequests = Math.max(0, options.limit - ipCount);

      // Execute Layer B (Email rate limit counter) if applicable
      let emailCount = 0;
      let emailEffectiveTtl = options.ttl;
      let emailRemainingRequests = options.limit;

      if (emailKey) {
        emailCount = Number(
          await this.redisService.getClient().eval(
            luaScript,
            1,
            emailKey,
            options.ttl.toString(),
          ),
        );
        const emailRemainingTtl = await this.redisService.ttl(emailKey);
        emailEffectiveTtl =
          emailRemainingTtl > 0 ? emailRemainingTtl : options.ttl;
        emailRemainingRequests = Math.max(0, options.limit - emailCount);
      }

      // 4. Attach standard rate-limiting headers (IETF draft standard)
      const remainingRequests = emailKey
        ? Math.min(ipRemainingRequests, emailRemainingRequests)
        : ipRemainingRequests;
      const effectiveTtl = emailKey
        ? Math.max(ipEffectiveTtl, emailEffectiveTtl)
        : ipEffectiveTtl;
      const resetTime = Math.ceil(Date.now() / 1000) + effectiveTtl;

      res.setHeader('X-RateLimit-Limit', options.limit.toString());
      res.setHeader('X-RateLimit-Remaining', remainingRequests.toString());
      res.setHeader('X-RateLimit-Reset', resetTime.toString());

      // 5. Dual-Layer Threshold Checks (IP or Email exceeded)
      if (ipCount > options.limit) {
        res.setHeader('Retry-After', ipEffectiveTtl.toString());
        this.logger.warn(
          `[RateLimit Blocked] IP: ${clientIp} exceeded limit (${ipCount}/${options.limit}) for prefix "${prefix}". Retry-After: ${ipEffectiveTtl}s`,
        );

        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            message: `Too many requests from this IP address. Please try again in ${Math.ceil(ipEffectiveTtl / 60)} minutes.`,
            retryAfter: ipEffectiveTtl,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      if (emailKey && emailCount > options.limit) {
        res.setHeader('Retry-After', emailEffectiveTtl.toString());
        this.logger.warn(
          `[RateLimit Blocked] Target account (hash: ${emailHash}) exceeded limit (${emailCount}/${options.limit}) for prefix "${prefix}". Retry-After: ${emailEffectiveTtl}s`,
        );

        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            message: `Too many requests targeting this account. Please try again in ${Math.ceil(emailEffectiveTtl / 60)} minutes.`,
            retryAfter: emailEffectiveTtl,
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
   * Relies safely on Express-sanitized req.ip (via 'trust proxy' configuration) or socket remoteAddress.
   */
  private extractClientIp(req: Request): string {
    let clientIp = req.ip || req.socket?.remoteAddress || '127.0.0.1';

    if (clientIp.startsWith('::ffff:')) {
      clientIp = clientIp.substring(7);
    }

    return clientIp;
  }
}
