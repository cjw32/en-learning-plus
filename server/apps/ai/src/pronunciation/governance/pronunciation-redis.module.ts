import {
  Global,
  Inject,
  Injectable,
  Module,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis, { type RedisOptions } from 'ioredis';
import type { PronunciationAtomicRedisClient } from './pronunciation-admission.service';

export const PRONUNCIATION_REDIS_CLIENT_FACTORY = Symbol(
  'PRONUNCIATION_REDIS_CLIENT_FACTORY',
);

export type PronunciationRedisOptions = Readonly<{
  host: string;
  port: number;
  password?: string;
  db: number;
}>;

export interface PronunciationRedisClient {
  readonly status: string;
  connect(): Promise<unknown>;
  ping(): Promise<unknown>;
  disconnect(reconnect?: boolean): void;
}

export type PronunciationRedisClientFactory = (
  options: RedisOptions,
) => PronunciationRedisClient;

export class PronunciationRedisConfigurationError extends Error {
  readonly code = 'FEATURE_DISABLED';
}

export class PronunciationRedisUnavailableError extends Error {
  readonly code = 'FEATURE_DISABLED';

  constructor() {
    super('Pronunciation Redis is unavailable');
    this.name = 'PronunciationRedisUnavailableError';
  }
}

function required(config: ConfigService, name: string): string {
  const value = config.get<string>(name)?.trim();
  if (!value) {
    throw new PronunciationRedisConfigurationError(`${name} is required`);
  }
  return value;
}

export function resolvePronunciationRedisOptions(
  config: ConfigService,
): PronunciationRedisOptions {
  const host = required(config, 'REDIS_HOST');
  const port = Number(required(config, 'REDIS_PORT'));
  const database = Number(required(config, 'PRONUNCIATION_REDIS_DB'));
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new PronunciationRedisConfigurationError(
      'REDIS_PORT must be a valid TCP port',
    );
  }
  if (!Number.isSafeInteger(database) || database < 0) {
    throw new PronunciationRedisConfigurationError(
      'PRONUNCIATION_REDIS_DB must be a non-negative integer',
    );
  }
  const password = config.get<string>('REDIS_PASSWORD');
  return Object.freeze({
    host,
    port,
    ...(password ? { password } : {}),
    db: database,
  });
}

@Injectable()
export class PronunciationRedisConnection implements OnModuleDestroy {
  private redis: PronunciationRedisClient | undefined;

  constructor(
    private readonly config: ConfigService,
    @Optional()
    @Inject(PRONUNCIATION_REDIS_CLIENT_FACTORY)
    private readonly clientFactory?: PronunciationRedisClientFactory,
  ) {}

  getConnectionOptions(): PronunciationRedisOptions {
    return resolvePronunciationRedisOptions(this.config);
  }

  /** The same tuple is passed to BullMQ and governance clients. */
  getBullConnectionOptions(): PronunciationRedisOptions {
    return this.getConnectionOptions();
  }

  getClient(): PronunciationRedisClient {
    if (!this.redis) {
      const options: RedisOptions = {
        ...this.getConnectionOptions(),
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
      };
      this.redis = (this.clientFactory ?? ((value) => new Redis(value)))(
        options,
      );
    }
    return this.redis;
  }

  getAtomicClient(): PronunciationAtomicRedisClient {
    const client = this.getClient();
    if (!('eval' in client) || typeof client.eval !== 'function') throw new PronunciationRedisUnavailableError();
    return client as PronunciationRedisClient & PronunciationAtomicRedisClient;
  }

  async assertReady(): Promise<void> {
    const client = this.getClient();
    try {
      if (client.status === 'wait') await client.connect();
      await client.ping();
    } catch {
      client.disconnect(false);
      this.redis = undefined;
      throw new PronunciationRedisUnavailableError();
    }
  }

  onModuleDestroy(): Promise<void> {
    if (this.redis && this.redis.status !== 'end') {
      this.redis.disconnect(false);
    }
    this.redis = undefined;
    return Promise.resolve();
  }
}

@Global()
@Module({
  providers: [PronunciationRedisConnection],
  exports: [PronunciationRedisConnection],
})
export class PronunciationRedisModule {}
