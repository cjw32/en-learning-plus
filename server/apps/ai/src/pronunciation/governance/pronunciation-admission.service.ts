/* eslint-disable @typescript-eslint/require-await -- The in-memory admission adapter must execute its promise-returning port atomically without yielding. */

import { createHash, randomUUID } from 'node:crypto';

export const PRONUNCIATION_ADMISSION_STORE = Symbol(
  'PRONUNCIATION_ADMISSION_STORE',
);

const MINUTE_LIMIT = 6;
const DAY_LIMIT = 120;
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

export type PronunciationAdmissionReservation = Readonly<{
  activeKey: string;
  minuteKey: string;
  dayKey: string;
  token: string;
}>;

export type PronunciationAdmissionDecision =
  | Readonly<{
      accepted: true;
      reservation: PronunciationAdmissionReservation;
    }>
  | Readonly<{
      accepted: false;
      reason: 'CONCURRENCY_LIMITED' | 'RATE_LIMITED';
      retryAfterSeconds: number;
    }>;

export interface PronunciationAdmissionStore {
  acquire(
    input: Readonly<{
      subjectHash: string;
      token: string;
      nowMs: number;
      activeTtlSeconds: number;
    }>,
  ): Promise<PronunciationAdmissionDecision>;
  release(reservation: PronunciationAdmissionReservation): Promise<void>;
  rollback(reservation: PronunciationAdmissionReservation): Promise<void>;
}

export interface PronunciationAtomicRedisClient {
  eval(
    script: string,
    numberOfKeys: number,
    ...args: Array<string | number>
  ): Promise<unknown>;
}

export class PronunciationAdmissionError extends Error {
  constructor(
    readonly code: 'CONCURRENCY_LIMITED' | 'RATE_LIMITED',
    readonly retryAfterSeconds: number,
  ) {
    super(code);
    this.name = 'PronunciationAdmissionError';
  }
}

const acquireScript = `
local activeTtl = redis.call('PTTL', KEYS[1])
if activeTtl > 0 then return {1, activeTtl} end
local minuteCount = tonumber(redis.call('GET', KEYS[2]) or '0')
if minuteCount >= tonumber(ARGV[3]) then return {2, tonumber(ARGV[5])} end
local dayCount = tonumber(redis.call('GET', KEYS[3]) or '0')
if dayCount >= tonumber(ARGV[4]) then return {2, tonumber(ARGV[6])} end
local claimed = redis.call('SET', KEYS[1], ARGV[1], 'NX', 'PX', ARGV[2])
if not claimed then return {1, tonumber(ARGV[2])} end
redis.call('INCR', KEYS[2])
redis.call('PEXPIRE', KEYS[2], ARGV[5])
redis.call('INCR', KEYS[3])
redis.call('PEXPIRE', KEYS[3], ARGV[6])
return {0, 0}
`;

const releaseScript = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  redis.call('DEL', KEYS[1])
end
return 1
`;

const rollbackScript = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
redis.call('DEL', KEYS[1])
local minuteCount = tonumber(redis.call('GET', KEYS[2]) or '0')
if minuteCount <= 1 then redis.call('DEL', KEYS[2]) else redis.call('DECR', KEYS[2]) end
local dayCount = tonumber(redis.call('GET', KEYS[3]) or '0')
if dayCount <= 1 then redis.call('DEL', KEYS[3]) else redis.call('DECR', KEYS[3]) end
return 1
`;

function windowTtl(nowMs: number, windowMs: number): number {
  return windowMs - (nowMs % windowMs);
}

function keysFor(subjectHash: string, nowMs: number) {
  return Object.freeze({
    activeKey: `pronunciation:active:${subjectHash}`,
    minuteKey: `pronunciation:minute:${subjectHash}:${Math.floor(nowMs / MINUTE_MS)}`,
    dayKey: `pronunciation:day:${subjectHash}:${Math.floor(nowMs / DAY_MS)}`,
  });
}

export class RedisPronunciationAdmissionStore implements PronunciationAdmissionStore {
  constructor(private readonly redis: PronunciationAtomicRedisClient) {}

  async acquire(
    input: Readonly<{
      subjectHash: string;
      token: string;
      nowMs: number;
      activeTtlSeconds: number;
    }>,
  ): Promise<PronunciationAdmissionDecision> {
    const keys = keysFor(input.subjectHash, input.nowMs);
    const minuteTtl = windowTtl(input.nowMs, MINUTE_MS);
    const dayTtl = windowTtl(input.nowMs, DAY_MS);
    const response = await this.redis.eval(
      acquireScript,
      3,
      keys.activeKey,
      keys.minuteKey,
      keys.dayKey,
      input.token,
      input.activeTtlSeconds * 1_000,
      MINUTE_LIMIT,
      DAY_LIMIT,
      minuteTtl,
      dayTtl,
    );
    if (!Array.isArray(response)) throw new Error('Invalid Redis response');
    const code = Number(response[0]);
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil(Number(response[1]) / 1_000),
    );
    if (code === 1) {
      return {
        accepted: false,
        reason: 'CONCURRENCY_LIMITED',
        retryAfterSeconds,
      };
    }
    if (code === 2) {
      return { accepted: false, reason: 'RATE_LIMITED', retryAfterSeconds };
    }
    if (code !== 0) throw new Error('Invalid Redis admission decision');
    return {
      accepted: true,
      reservation: Object.freeze({ ...keys, token: input.token }),
    };
  }

  async release(reservation: PronunciationAdmissionReservation): Promise<void> {
    await this.redis.eval(
      releaseScript,
      1,
      reservation.activeKey,
      reservation.token,
    );
  }

  async rollback(
    reservation: PronunciationAdmissionReservation,
  ): Promise<void> {
    await this.redis.eval(
      rollbackScript,
      3,
      reservation.activeKey,
      reservation.minuteKey,
      reservation.dayKey,
      reservation.token,
    );
  }
}

type MemoryCounter = { count: number; expiresAt: number };
type MemoryActive = { token: string; expiresAt: number };

export class InMemoryPronunciationAdmissionStore implements PronunciationAdmissionStore {
  private readonly active = new Map<string, MemoryActive>();
  private readonly counters = new Map<string, MemoryCounter>();

  async acquire(
    input: Readonly<{
      subjectHash: string;
      token: string;
      nowMs: number;
      activeTtlSeconds: number;
    }>,
  ): Promise<PronunciationAdmissionDecision> {
    const keys = keysFor(input.subjectHash, input.nowMs);
    const currentActive = this.active.get(keys.activeKey);
    if (currentActive && currentActive.expiresAt > input.nowMs) {
      return {
        accepted: false,
        reason: 'CONCURRENCY_LIMITED',
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((currentActive.expiresAt - input.nowMs) / 1_000),
        ),
      };
    }
    if (currentActive) this.active.delete(keys.activeKey);
    const minute = this.liveCounter(keys.minuteKey, input.nowMs);
    const day = this.liveCounter(keys.dayKey, input.nowMs);
    if ((minute?.count ?? 0) >= MINUTE_LIMIT) {
      return {
        accepted: false,
        reason: 'RATE_LIMITED',
        retryAfterSeconds: Math.max(
          1,
          Math.ceil(((minute?.expiresAt ?? input.nowMs) - input.nowMs) / 1_000),
        ),
      };
    }
    if ((day?.count ?? 0) >= DAY_LIMIT) {
      return {
        accepted: false,
        reason: 'RATE_LIMITED',
        retryAfterSeconds: Math.max(
          1,
          Math.ceil(((day?.expiresAt ?? input.nowMs) - input.nowMs) / 1_000),
        ),
      };
    }
    this.active.set(keys.activeKey, {
      token: input.token,
      expiresAt: input.nowMs + input.activeTtlSeconds * 1_000,
    });
    this.increment(
      keys.minuteKey,
      input.nowMs + windowTtl(input.nowMs, MINUTE_MS),
    );
    this.increment(keys.dayKey, input.nowMs + windowTtl(input.nowMs, DAY_MS));
    return {
      accepted: true,
      reservation: Object.freeze({ ...keys, token: input.token }),
    };
  }

  async release(reservation: PronunciationAdmissionReservation): Promise<void> {
    const active = this.active.get(reservation.activeKey);
    if (active?.token === reservation.token) {
      this.active.delete(reservation.activeKey);
    }
  }

  async rollback(
    reservation: PronunciationAdmissionReservation,
  ): Promise<void> {
    const active = this.active.get(reservation.activeKey);
    if (active?.token !== reservation.token) return;
    this.active.delete(reservation.activeKey);
    this.decrement(reservation.minuteKey);
    this.decrement(reservation.dayKey);
  }

  private liveCounter(key: string, nowMs: number): MemoryCounter | undefined {
    const counter = this.counters.get(key);
    if (counter && counter.expiresAt <= nowMs) {
      this.counters.delete(key);
      return undefined;
    }
    return counter;
  }

  private increment(key: string, expiresAt: number): void {
    const counter = this.counters.get(key);
    this.counters.set(key, {
      count: (counter?.count ?? 0) + 1,
      expiresAt,
    });
  }

  private decrement(key: string): void {
    const counter = this.counters.get(key);
    if (!counter || counter.count <= 1) this.counters.delete(key);
    else counter.count -= 1;
  }
}

export type PronunciationAdmissionLease = Readonly<{
  release(): Promise<void>;
  rollback(): Promise<void>;
}>;

function isUniqueConstraint(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002',
  );
}

export class PronunciationAdmissionService {
  constructor(
    private readonly store: PronunciationAdmissionStore,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async admit(
    input: Readonly<{
      subjectId: string;
      assessmentId: string;
      activeTtlSeconds: number;
      confirmDurableClaim?: () => Promise<void>;
    }>,
  ): Promise<PronunciationAdmissionLease> {
    if (!input.subjectId || !input.assessmentId) {
      throw new Error('Admission identity is required');
    }
    if (
      !Number.isSafeInteger(input.activeTtlSeconds) ||
      input.activeTtlSeconds < 1
    ) {
      throw new Error('Active lease TTL must be a positive integer');
    }
    const subjectHash = createHash('sha256')
      .update(`pronunciation:${input.subjectId}`)
      .digest('hex');
    const decision = await this.store.acquire({
      subjectHash,
      token: `${input.assessmentId}:${randomUUID()}`,
      nowMs: this.now(),
      activeTtlSeconds: input.activeTtlSeconds,
    });
    if (!decision.accepted) {
      throw new PronunciationAdmissionError(
        decision.reason,
        decision.retryAfterSeconds,
      );
    }
    try {
      await input.confirmDurableClaim?.();
    } catch (error) {
      await this.store.rollback(decision.reservation);
      if (isUniqueConstraint(error)) {
        throw new PronunciationAdmissionError('CONCURRENCY_LIMITED', 1);
      }
      throw error;
    }

    let closed = false;
    return Object.freeze({
      release: async () => {
        if (closed) return;
        closed = true;
        await this.store.release(decision.reservation);
      },
      rollback: async () => {
        if (closed) return;
        closed = true;
        await this.store.rollback(decision.reservation);
      },
    });
  }
}
