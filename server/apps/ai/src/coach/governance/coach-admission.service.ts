import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { CoachRedisConnection } from '../streaming/coach-redis.module';
import { CoachBudgetExceededError } from './coach-budget.service';
import {
  CoachRateLimitService,
  type CoachRateLimitStore,
} from './coach-rate-limit.service';

export interface CoachConcurrencyStore {
  acquire(key: string, limit: number, ttlSeconds: number): Promise<boolean>;
  release(key: string): Promise<void>;
}

const ACQUIRE_SCRIPT = `
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
if current >= tonumber(ARGV[1]) then return 0 end
local next = redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], ARGV[2])
return next
`;

const RELEASE_SCRIPT = `
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
if current <= 1 then redis.call('DEL', KEYS[1]); return 0 end
return redis.call('DECR', KEYS[1])
`;

@Injectable()
export class RedisCoachGovernanceStore
  implements CoachRateLimitStore, CoachConcurrencyStore
{
  constructor(private readonly redis: CoachRedisConnection) {}

  async increment(key: string, windowSeconds: number) {
    await this.connect();
    const count = await this.redis.client.incr(key);
    if (count === 1) await this.redis.client.expire(key, windowSeconds);
    return count;
  }

  async acquire(key: string, limit: number, ttlSeconds: number) {
    await this.connect();
    return Number(
      await this.redis.client.eval(
        ACQUIRE_SCRIPT,
        1,
        key,
        String(limit),
        String(ttlSeconds),
      ),
    ) > 0;
  }

  async release(key: string) {
    await this.connect();
    await this.redis.client.eval(RELEASE_SCRIPT, 1, key);
  }

  private async connect() {
    if (this.redis.client.status === 'wait') await this.redis.client.connect();
  }
}

@Injectable()
export class CoachAdmissionService {
  constructor(
    private readonly rateStore: CoachRateLimitStore,
    private readonly concurrencyStore: CoachConcurrencyStore,
    private readonly environment: NodeJS.ProcessEnv = process.env,
  ) {}

  async consumeIp(ipAddress: string | undefined) {
    const windowSeconds = this.policy('COACH_RATE_LIMIT_WINDOW_SECONDS');
    return new CoachRateLimitService(
      this.rateStore,
      {
        limit: this.policy('COACH_RATE_LIMIT_IP_COUNT'),
        windowSeconds,
      },
    ).consumeIp(ipAddress || 'unavailable', 'request');
  }

  async acquireSubject(subjectId: string) {
    const windowSeconds = this.policy('COACH_RATE_LIMIT_WINDOW_SECONDS');
    await new CoachRateLimitService(
      this.rateStore,
      {
        limit: this.policy('COACH_RATE_LIMIT_SUBJECT_COUNT'),
        windowSeconds,
      },
    ).consume(subjectId, 'request');
    const ttlSeconds = Math.ceil(
      this.policy('COACH_MAX_DURATION_MS') / 1000,
    ) + 60;
    const acquired = await this.concurrencyStore.acquire(
      this.concurrencyKey(subjectId),
      this.policy('COACH_MAX_CONCURRENT_REQUESTS'),
      ttlSeconds,
    );
    if (!acquired) {
      throw Object.assign(new Error('Coach concurrency limit exceeded'), {
        code: 'RATE_LIMITED',
        retryAfterSeconds: ttlSeconds,
      });
    }
  }

  releaseSubject(subjectId: string) {
    return this.concurrencyStore.release(this.concurrencyKey(subjectId));
  }

  private concurrencyKey(subjectId: string) {
    return `coach:concurrency:${createHash('sha256')
      .update(subjectId)
      .digest('hex')}`;
  }

  private policy(name: string) {
    const raw = this.environment[name];
    if (!raw || !/^\d+$/.test(raw) || Number(raw) < 1) {
      throw new CoachBudgetExceededError(`${name} is not approved`);
    }
    return Number(raw);
  }
}
