import { createHash } from 'node:crypto';
import type { PronunciationAtomicRedisClient } from './pronunciation-admission.service';
import { PronunciationAdmissionError } from './pronunciation-admission.service';
import { PronunciationBudgetError } from './pronunciation-budget.service';

const reserveScript = `
local old = redis.call('GET', KEYS[2])
if old then
  local row = cjson.decode(old)
  if row.fingerprint == ARGV[2] and row.state == 'reserved' and redis.call('GET', KEYS[1]) == ARGV[1] then return 'REPLAY' end
  return 'CONFLICT'
end
if redis.call('EXISTS', KEYS[1]) == 1 then return 'BUSY' end
local amount = tonumber(ARGV[3])
for i=3,5 do
  if tonumber(redis.call('GET', KEYS[i]) or '0') + amount > tonumber(ARGV[i+1]) then return 'EXCEEDED' end
end
redis.call('SET', KEYS[1], ARGV[1], 'PX', 35000)
redis.call('SET', KEYS[2], cjson.encode({fingerprint=ARGV[2], amount=amount, state='reserved', counters={KEYS[3],KEYS[4],KEYS[5]}}), 'EX', 3888000)
for i=3,5 do redis.call('INCRBY', KEYS[i], amount); redis.call('EXPIRE', KEYS[i], 3888000) end
return 'RESERVED'
`;
const finishScript = `
local raw = redis.call('GET', KEYS[2])
if not raw then return 0 end
local row = cjson.decode(raw)
if ARGV[2] == 'release' and row.state == 'reserved' then
  for _,key in ipairs(row.counters) do redis.call('INCRBY', key, -row.amount) end
  row.state = 'released'
elseif (ARGV[2] == 'spend' or ARGV[2] == 'complete') and row.state == 'reserved' then row.state = 'spent' end
redis.call('SET', KEYS[2], cjson.encode(row), 'KEEPTTL')
if (ARGV[2] == 'complete' or (ARGV[2] == 'release' and row.state == 'released')) and redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('DEL', KEYS[1]) end
return 1
`;

export class PronunciationUsageService {
  private readonly prefix: string;
  constructor(
    private readonly redis: PronunciationAtomicRedisClient,
    scope: string,
    private readonly caps: {
      subjectDaySeconds: number;
      daySeconds: number;
      monthSeconds: number;
    },
  ) {
    if (
      !scope ||
      Object.values(caps).some((v) => !Number.isSafeInteger(v) || v <= 0)
    ) {
      throw new PronunciationBudgetError('BUDGET_NOT_APPROVED');
    }
    this.prefix = `pronunciation:{usage-${createHash('sha256').update(scope).digest('hex')}}`;
  }
  private reservation(id: string) {
    return `${this.prefix}:reservation:${createHash('sha256').update(id).digest('hex')}`;
  }
  async reserve(
    id: string,
    subjectId: string,
    durationMs: number,
    now = new Date(),
  ) {
    if (
      !id ||
      !subjectId ||
      !Number.isFinite(durationMs) ||
      durationMs <= 0 ||
      durationMs > 30000
    ) {
      throw new PronunciationBudgetError('BUDGET_NOT_APPROVED');
    }
    const date = now.toISOString();
    const subject = createHash('sha256').update(subjectId).digest('hex');
    const seconds = Math.ceil(durationMs / 1000);
    const decision = String(
      await this.redis.eval(
        reserveScript,
        5,
        `${this.prefix}:active`,
        this.reservation(id),
        `${this.prefix}:subject:${subject}:${date.slice(0, 10)}`,
        `${this.prefix}:day:${date.slice(0, 10)}`,
        `${this.prefix}:month:${date.slice(0, 7)}`,
        id,
        JSON.stringify({ subject, seconds, day: date.slice(0, 10) }),
        seconds,
        this.caps.subjectDaySeconds,
        this.caps.daySeconds,
        this.caps.monthSeconds,
      ),
    );
    if (decision === 'BUSY')
      throw new PronunciationAdmissionError('CONCURRENCY_LIMITED', 35);
    if (decision === 'EXCEEDED')
      throw new PronunciationBudgetError('BUDGET_EXCEEDED');
    if (!['RESERVED', 'REPLAY'].includes(decision))
      throw new PronunciationBudgetError('STATE_CONFLICT');
  }
  private async finish(id: string, action: string) {
    await this.redis.eval(
      finishScript,
      2,
      `${this.prefix}:active`,
      this.reservation(id),
      id,
      action,
    );
  }
  spend(id: string) {
    return this.finish(id, 'spend');
  }
  complete(id: string) {
    return this.finish(id, 'complete');
  }
  release(id: string) {
    return this.finish(id, 'release');
  }
}
