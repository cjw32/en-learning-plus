import { Injectable } from '@nestjs/common';
import { PronunciationRedisConnection } from './pronunciation-redis.module';
import { createHash } from 'node:crypto';
import { PronunciationAdmissionError } from './pronunciation-admission.service';
import type { PronunciationSubmitAdmission } from '../application/pronunciation-assessment.service';

const script = `
local existing = redis.call('GET', KEYS[1])
if existing == ARGV[1] then return 0 end
if existing then return 1 end
if tonumber(redis.call('GET', KEYS[2]) or '0') >= 6 then return 2 end
if tonumber(redis.call('GET', KEYS[3]) or '0') >= 120 then return 2 end
redis.call('SET', KEYS[1], ARGV[1], 'EX', 65)
redis.call('INCR', KEYS[2]); redis.call('EXPIRE', KEYS[2], ARGV[2])
redis.call('INCR', KEYS[3]); redis.call('EXPIRE', KEYS[3], ARGV[3])
return 0
`;
@Injectable()
export class PronunciationSubmitAdmissionService implements PronunciationSubmitAdmission {
  constructor(private readonly connection: PronunciationRedisConnection) {}
  private active(subjectId: string) {
    const hash = createHash('sha256').update(subjectId).digest('hex');
    return `pronunciation:{submit-${hash}}`;
  }
  async assertCanSubmit(subjectId: string, assessmentId: string) {
    const now = Date.now();
    const prefix = this.active(subjectId);
    await this.connection.assertReady();
    const code = Number(
      await this.connection
        .getAtomicClient()
        .eval(
          script,
          3,
          `${prefix}:active`,
          `${prefix}:minute:${Math.floor(now / 60000)}`,
          `${prefix}:day:${Math.floor(now / 86400000)}`,
          assessmentId,
          Math.ceil((60000 - (now % 60000)) / 1000),
          Math.ceil((86400000 - (now % 86400000)) / 1000),
        ),
    );
    if (code === 1 || code === 2)
      throw new PronunciationAdmissionError(
        code === 1 ? 'CONCURRENCY_LIMITED' : 'RATE_LIMITED',
        code === 1 ? 65 : 60,
      );
    if (code !== 0) throw new Error('PRONUNCIATION_ADMISSION_UNAVAILABLE');
  }
  async release(subjectId: string, assessmentId: string) {
    await this.connection
      .getAtomicClient()
      .eval(
        "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0",
        1,
        `${this.active(subjectId)}:active`,
        assessmentId,
      );
  }
}
