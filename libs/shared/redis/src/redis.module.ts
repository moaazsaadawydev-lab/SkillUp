import {
  DynamicModule,
  Global,
  Module,
  Provider,
} from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT, REDIS_MODULE_OPTIONS } from './redis.constants';
import {
  RedisModuleAsyncOptions,
  RedisModuleOptions,
  RedisOptionsFactory,
} from './redis.interfaces';
import { RedisService } from './redis.service';

@Global()
@Module({})
export class RedisModule {
  static forRoot(options: RedisModuleOptions = {}): DynamicModule {
    const redisClientProvider: Provider = {
      provide: REDIS_CLIENT,
      useFactory: () => this.createClient(options),
    };

    return {
      module: RedisModule,
      providers: [
        {
          provide: REDIS_MODULE_OPTIONS,
          useValue: options,
        },
        redisClientProvider,
        RedisService,
      ],
      exports: [REDIS_CLIENT, RedisService],
    };
  }

  static forRootAsync(options: RedisModuleAsyncOptions): DynamicModule {
    const redisClientProvider: Provider = {
      provide: REDIS_CLIENT,
      inject: [REDIS_MODULE_OPTIONS],
      useFactory: (opts: RedisModuleOptions) => this.createClient(opts),
    };

    const asyncProviders = this.createAsyncProviders(options);

    return {
      module: RedisModule,
      imports: options.imports || [],
      providers: [...asyncProviders, redisClientProvider, RedisService],
      exports: [REDIS_CLIENT, RedisService],
    };
  }

  private static createClient(options: RedisModuleOptions): Redis {
    const { url, host = 'localhost', port = 6379, password, ...rest } = options;

    const baseOptions = {
      host,
      port,
      password: password || undefined,
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      retryStrategy(times: number) {
        const maxReconnectAttempts = 15;
        if (times > maxReconnectAttempts) {
          return null; // Stop reconnecting to prevent infinite loops / memory leaks
        }
        return Math.min(times * 100, 3000); // Exponential backoff capped at 3 seconds
      },
      ...rest,
    };

    if (url) {
      return new Redis(url, baseOptions);
    }

    return new Redis(baseOptions);
  }

  private static createAsyncProviders(
    options: RedisModuleAsyncOptions,
  ): Provider[] {
    if (options.useFactory) {
      return [
        {
          provide: REDIS_MODULE_OPTIONS,
          useFactory: options.useFactory,
          inject: options.inject || [],
        },
      ];
    }

    if (options.useClass) {
      return [
        {
          provide: REDIS_MODULE_OPTIONS,
          useFactory: async (optionsFactory: RedisOptionsFactory) =>
            optionsFactory.createRedisOptions(),
          inject: [options.useClass],
        },
        {
          provide: options.useClass,
          useClass: options.useClass,
        },
      ];
    }

    if (options.useExisting) {
      return [
        {
          provide: REDIS_MODULE_OPTIONS,
          useFactory: async (optionsFactory: RedisOptionsFactory) =>
            optionsFactory.createRedisOptions(),
          inject: [options.useExisting],
        },
      ];
    }

    return [];
  }
}
