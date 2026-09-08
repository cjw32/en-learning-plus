import { Global, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class CoachRedisConnection implements OnModuleDestroy {
  readonly client: Redis;

  constructor(config: ConfigService) {
    this.client = new Redis({
      host: config.get<string>('REDIS_HOST') ?? '127.0.0.1',
      port: Number(config.get<string>('REDIS_PORT') ?? 6379),
      password: config.get<string>('REDIS_PASSWORD') || undefined,
      db: Number(config.get<string>('COACH_REDIS_DB') ?? 0),
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
    });
  }

  onModuleDestroy() {
    if (this.client.status !== 'end') {
      this.client.disconnect(false);
    }
  }
}

@Global()
@Module({
  providers: [CoachRedisConnection],
  exports: [CoachRedisConnection],
})
export class CoachRedisModule {}
