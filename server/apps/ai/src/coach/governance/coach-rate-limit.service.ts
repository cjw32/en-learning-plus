import { createHash } from 'node:crypto';

export interface CoachRateLimitStore {
  increment(key: string, windowSeconds: number): Promise<number>;
}

export class InMemoryRateLimitStore implements CoachRateLimitStore {
  private readonly counts = new Map<string, number>();

  async increment(key: string): Promise<number> {
    const count = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, count);
    return count;
  }
}

export class CoachRateLimitError extends Error {
  readonly code = 'RATE_LIMITED';

  constructor(readonly retryAfterSeconds: number) {
    super('Coach request rate limit exceeded');
  }
}

export class CoachRateLimitService {
  constructor(
    private readonly store: CoachRateLimitStore,
    private readonly policy: { limit: number; windowSeconds: number },
    private readonly now: () => number = () => Date.now(),
  ) {}

  async consume(subjectId: string, operation: string) {
    return this.consumeIdentity(`subject:${subjectId}`, operation);
  }

  async consumeIp(ipAddress: string, operation: string) {
    return this.consumeIdentity(`ip:${ipAddress}`, operation);
  }

  private async consumeIdentity(identity: string, operation: string) {
    const subjectHash = createHash('sha256').update(identity).digest('hex');
    const window = Math.floor(
      this.now() / (this.policy.windowSeconds * 1000),
    );
    const key = `coach:rate:${subjectHash}:${operation}:${window}`;
    const count = await this.store.increment(key, this.policy.windowSeconds);
    if (count > this.policy.limit) {
      throw new CoachRateLimitError(this.policy.windowSeconds);
    }
    return Object.freeze({
      remaining: this.policy.limit - count,
      retryAfterSeconds: this.policy.windowSeconds,
    });
  }
}

export class CoachConcurrencyLimitService {
  private readonly active = new Map<string, number>();

  constructor(private readonly limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new Error('Concurrency limit must be a positive integer');
    }
  }

  acquire(subjectId: string) {
    const count = this.active.get(subjectId) ?? 0;
    if (count >= this.limit) throw new CoachRateLimitError(1);
    this.active.set(subjectId, count + 1);
    let released = false;
    return Object.freeze({
      release: () => {
        if (released) return;
        released = true;
        const current = this.active.get(subjectId) ?? 1;
        if (current <= 1) this.active.delete(subjectId);
        else this.active.set(subjectId, current - 1);
      },
    });
  }
}
