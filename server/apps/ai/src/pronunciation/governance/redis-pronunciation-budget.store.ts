import { createHash } from 'node:crypto';
import type { PronunciationAtomicRedisClient } from './pronunciation-admission.service';
import type {
  PronunciationBudgetReservation,
  PronunciationBudgetStore,
} from './pronunciation-budget.service';

// One script reserves all counters; retaining unknown/unfinished reservations
// is conservative when a worker disappears after a potentially billable call.
const reserveScript = `
local existing = redis.call('GET', KEYS[1])
if existing then
  local row = cjson.decode(existing)
  if row.fingerprint == ARGV[1] then return 'REPLAY' end
  return 'CONFLICT'
end
local amount = tonumber(ARGV[2])
if amount > tonumber(ARGV[3]) then return 'EXCEEDED' end
for i=2,4 do
  if tonumber(redis.call('GET', KEYS[i]) or '0') + amount > tonumber(ARGV[i+2]) then return 'EXCEEDED' end
end
local row = {fingerprint=ARGV[1], amount=amount, settled=false, released=false, counters={KEYS[2],KEYS[3],KEYS[4]}}
redis.call('SET', KEYS[1], cjson.encode(row), 'EX', ARGV[7])
for i=2,4 do redis.call('INCRBY', KEYS[i], amount); redis.call('EXPIRE', KEYS[i], ARGV[7]) end
return 'RESERVED'
`;
const settleScript = `
local value = redis.call('GET', KEYS[1])
if not value then return 'NOT_FOUND' end
local row = cjson.decode(value)
if row.released then return 'NOT_FOUND' end
local actual = tonumber(ARGV[1])
if row.settled ~= false then
  if row.settled == actual then return 'REPLAY' end
  return 'CONFLICT'
end
if actual < 0 or actual > row.amount then return 'CONFLICT' end
for _,key in ipairs(row.counters) do redis.call('INCRBY', key, actual-row.amount) end
row.settled = actual
redis.call('SET', KEYS[1], cjson.encode(row), 'KEEPTTL')
return 'SETTLED'
`;
const releaseScript = `
local value = redis.call('GET', KEYS[1])
if not value then return 0 end
local row = cjson.decode(value)
if row.released or row.settled ~= false then return 0 end
for _,key in ipairs(row.counters) do redis.call('INCRBY', key, -row.amount) end
row.released = true
redis.call('SET', KEYS[1], cjson.encode(row), 'KEEPTTL')
return 1
`;

export class RedisPronunciationBudgetStore implements PronunciationBudgetStore {
  constructor(private readonly redis: PronunciationAtomicRedisClient) {}
  private key(id: string) {
    return `pronunciation:{budget}:reservation:${createHash('sha256').update(id).digest('hex')}`;
  }
  async reserve(
    reservation: PronunciationBudgetReservation,
    caps: Parameters<PronunciationBudgetStore['reserve']>[1],
  ) {
    const prefix = `pronunciation:{budget}:${reservation.currency}`;
    const result = await this.redis.eval(
      reserveScript,
      4,
      this.key(reservation.reservationId),
      `${prefix}:subject:${reservation.subjectHash}:${reservation.day}`,
      `${prefix}:day:${reservation.day}`,
      `${prefix}:month:${reservation.month}`,
      JSON.stringify(reservation),
      reservation.reservedMicros,
      caps.maxCallCostMicros,
      caps.subjectDailyBudgetMicros,
      caps.systemDailyBudgetMicros,
      caps.systemMonthlyBudgetMicros,
      45 * 86400,
    );
    if (
      !['RESERVED', 'REPLAY', 'EXCEEDED', 'CONFLICT'].includes(String(result))
    )
      throw new Error('PRONUNCIATION_BUDGET_STORE_UNAVAILABLE');
    return result as Awaited<ReturnType<PronunciationBudgetStore['reserve']>>;
  }
  async settle(id: string, actual: number) {
    const result = await this.redis.eval(settleScript, 1, this.key(id), actual);
    if (
      !['SETTLED', 'REPLAY', 'NOT_FOUND', 'CONFLICT'].includes(String(result))
    )
      throw new Error('PRONUNCIATION_BUDGET_STORE_UNAVAILABLE');
    return result as Awaited<ReturnType<PronunciationBudgetStore['settle']>>;
  }
  async release(id: string) {
    await this.redis.eval(releaseScript, 1, this.key(id));
  }
}
