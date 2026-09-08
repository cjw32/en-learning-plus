import { Inject, Injectable } from '@nestjs/common';
import {
  COACH_SSE_SCHEMA_VERSION,
  coachResultSchema,
  coachSseEventSchema,
  type CoachRequestStatus,
  type CoachResult,
  type CoachSseEvent,
} from '@en/common/coach';
import { CoachRedisConnection } from './coach-redis.module';

export type CoachEventAppend = Readonly<{
  requestId: string;
  timestamp: Date;
  type: CoachSseEvent['type'];
  payload: unknown;
  terminal: boolean;
  requiredPreviousEventId?: string;
}>;

export interface CoachEventStore {
  append(input: CoachEventAppend): Promise<CoachSseEvent>;
  readAfter(
    requestId: string,
    lastEventId?: string,
  ): Promise<CoachSseEvent[] | null>;
}

export const COACH_EVENT_STORE = Symbol('COACH_EVENT_STORE');

const APPEND_EVENT_SCRIPT = `
if redis.call('GET', KEYS[4]) then return redis.error_reply('COACH_STREAM_SEALED') end
local required = ARGV[5]
if required ~= '' then
  local previous = redis.call('GET', KEYS[3])
  if previous ~= required then return redis.error_reply('COACH_PREVIOUS_EVENT_MISMATCH') end
end
local sequence = redis.call('INCR', KEYS[2]) - 1
local eventId = 'evt_' .. tostring(sequence)
local event = { schemaVersion = ARGV[1], eventId = eventId, requestId = ARGV[2], sequence = sequence, timestamp = ARGV[3], type = ARGV[4], payload = cjson.decode(ARGV[6]) }
local encoded = cjson.encode(event)
redis.call('XADD', KEYS[1], 'MAXLEN', '~', 2000, '*', 'event', encoded)
redis.call('SET', KEYS[3], eventId, 'EX', 3600)
redis.call('EXPIRE', KEYS[1], 3600)
redis.call('EXPIRE', KEYS[2], 3600)
if ARGV[7] == '1' then redis.call('SET', KEYS[4], '1', 'EX', 3600) end
return encoded
`;

function streamKey(requestId: string) {
  if (!/^[A-Za-z0-9_-]{10,64}$/.test(requestId))
    throw new Error('Invalid Coach request ID');
  return `coach:events:${requestId}`;
}

@Injectable()
export class RedisCoachEventStore implements CoachEventStore {
  constructor(private readonly redis: CoachRedisConnection) {}

  async append(input: CoachEventAppend): Promise<CoachSseEvent> {
    await this.ensureConnected();
    const base = streamKey(input.requestId);
    const encoded = await this.redis.client.eval(
      APPEND_EVENT_SCRIPT,
      4,
      base,
      `${base}:sequence`,
      `${base}:last`,
      `${base}:sealed`,
      COACH_SSE_SCHEMA_VERSION,
      input.requestId,
      input.timestamp.toISOString(),
      input.type,
      input.requiredPreviousEventId ?? '',
      JSON.stringify(input.payload),
      input.terminal ? '1' : '0',
    );
    return coachSseEventSchema.parse(JSON.parse(String(encoded)));
  }

  async readAfter(requestId: string, lastEventId?: string) {
    await this.ensureConnected();
    const key = streamKey(requestId);
    if ((await this.redis.client.exists(key)) === 0)
      return lastEventId ? null : [];
    const rows = await this.redis.client.xrange(key, '-', '+');
    const events = rows.map(([, fields]) => {
      const index = fields.indexOf('event');
      if (index < 0 || !fields[index + 1])
        throw new Error('Invalid Coach event record');
      return coachSseEventSchema.parse(JSON.parse(fields[index + 1]));
    });
    if (!lastEventId) return events;
    const index = events.findIndex((event) => event.eventId === lastEventId);
    return index < 0 ? null : events.slice(index + 1);
  }

  private async ensureConnected() {
    if (this.redis.client.status === 'wait') await this.redis.client.connect();
  }
}

const statusLabels = {
  validating: '正在检查请求',
  understanding: '正在理解你的学习需求',
  personalizing: '正在读取你的学习进度',
  finding_materials: '正在查找相关学习材料',
  generating: '正在生成适合你的内容',
  grading: '正在批改答案',
  saving: '正在保存学习进度',
  recommending: '正在准备下一步建议',
  finalizing: '正在整理最终结果',
} as const;
const toolLabels = {
  get_learner_profile: '学习画像',
  get_due_words: '今日复习单词',
  search_learning_materials: '学习材料',
  create_exercise: '个性化练习',
  grade_answer: '答案批改',
  save_attempt: '学习记录',
} as const;
const toolStateLabels = {
  started: '正在处理',
  succeeded: '已完成',
  failed: '暂时失败',
  skipped: '已跳过',
} as const;

type StatusStep = keyof typeof statusLabels;
type ToolName = keyof typeof toolLabels;
type ToolState = keyof typeof toolStateLabels;
type ErrorPayload = Extract<CoachSseEvent, { type: 'error' }>['payload'];
type SaveStatus = Extract<
  CoachSseEvent,
  { type: 'cancelled' }
>['payload']['saveStatus'];
type LearningSaveStatus = Extract<
  CoachSseEvent,
  { type: 'completed' }
>['payload']['learningSaveStatus'];

@Injectable()
export class CoachEventStreamService {
  constructor(
    @Inject(COACH_EVENT_STORE) private readonly store: CoachEventStore,
    private readonly now: () => Date = () => new Date(),
  ) {}
  async readAfter(requestId: string, lastEventId?: string) {
    const events = await this.store.readAfter(requestId, lastEventId);
    if (!events) return null;
    const seen = new Set<string>();
    return events.filter((event) => {
      const parsed = coachSseEventSchema.parse(event);
      if (seen.has(parsed.eventId)) return false;
      seen.add(parsed.eventId);
      return true;
    });
  }
  publishConnected(
    requestId: string,
    status: CoachRequestStatus,
    replayedThrough: number | null,
  ) {
    return this.append(requestId, 'connected', { status, replayedThrough });
  }
  publishStatus(requestId: string, step: StatusStep) {
    return this.append(requestId, 'status', {
      step,
      label: statusLabels[step],
    });
  }
  publishToolStatus(
    requestId: string,
    tool: ToolName,
    state: ToolState,
    retryable: boolean | null,
  ) {
    return this.append(requestId, 'tool_status', {
      tool,
      state,
      label: `${toolLabels[tool]}${toolStateLabels[state]}`,
      retryable,
    });
  }
  publishContent(
    requestId: string,
    channel: Extract<
      CoachSseEvent,
      { type: 'content_delta' }
    >['payload']['channel'],
    delta: string,
  ) {
    return this.append(requestId, 'content_delta', { channel, delta });
  }
  publishResult(requestId: string, result: CoachResult) {
    return this.append(requestId, 'result', {
      result: coachResultSchema.parse(result),
    });
  }
  publishCompleted(
    requestId: string,
    resultEventId: string,
    learningSaveStatus: LearningSaveStatus,
  ) {
    return this.append(
      requestId,
      'completed',
      { status: 'COMPLETED', resultEventId, learningSaveStatus },
      true,
      resultEventId,
    );
  }
  publishCancelled(requestId: string, saveStatus: SaveStatus, message: string) {
    return this.append(
      requestId,
      'cancelled',
      { status: 'CANCELLED', saveStatus, message },
      true,
    );
  }
  publishError(requestId: string, payload: ErrorPayload) {
    return this.append(requestId, 'error', payload, true);
  }
  publishHeartbeat(requestId: string) {
    return this.append(requestId, 'heartbeat', {});
  }
  private async append(
    requestId: string,
    type: CoachSseEvent['type'],
    payload: unknown,
    terminal = false,
    requiredPreviousEventId?: string,
  ) {
    return coachSseEventSchema.parse(
      await this.store.append({
        requestId,
        timestamp: this.now(),
        type,
        payload,
        terminal,
        requiredPreviousEventId,
      }),
    );
  }
}
