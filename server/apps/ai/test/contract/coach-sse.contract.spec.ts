import {
  coachSseEventSchema,
  type CoachSseEvent,
} from '@en/common/coach';
import {
  CoachEventStreamService,
  type CoachEventAppend,
  type CoachEventStore,
} from '../../src/coach/streaming/coach-event-stream.service';

class MemoryEventStore implements CoachEventStore {
  readonly events: CoachSseEvent[] = [];
  sealed = false;

  async append(input: CoachEventAppend) {
    if (this.sealed) throw new Error('sealed');
    if (
      input.requiredPreviousEventId &&
      this.events.at(-1)?.eventId !== input.requiredPreviousEventId
    ) {
      throw new Error('previous event mismatch');
    }
    const sequence = this.events.length;
    const event = coachSseEventSchema.parse({
      schemaVersion: 'coach.sse.v1',
      eventId: `event_${String(sequence).padStart(6, '0')}`,
      requestId: input.requestId,
      sequence,
      timestamp: input.timestamp.toISOString(),
      type: input.type,
      payload: input.payload,
    });
    this.events.push(event);
    if (input.terminal) this.sealed = true;
    return event;
  }

  async readAfter(_requestId: string, lastEventId?: string) {
    if (!lastEventId) return [...this.events];
    const index = this.events.findIndex((event) => event.eventId === lastEventId);
    return index < 0 ? null : this.events.slice(index + 1);
  }
}

const result = {
  schemaVersion: 'coach.result.v1' as const,
  responseType: 'answer' as const,
  correction: '',
  explanation: 'Went is the past tense of go.',
  examples: [],
  errorTypes: [],
  score: null,
  nextAction: 'continue' as const,
  citations: [],
  nextActionReason: 'Continue with another example.',
  traceId: 'trace_stream_0001',
};

describe('Coach SSE contract', () => {
  it('builds every public event with strict sequence and server-owned labels', async () => {
    const store = new MemoryEventStore();
    const stream = new CoachEventStreamService(
      store,
      () => new Date('2026-09-02T00:00:00.000Z'),
    );
    await stream.publishConnected('request_00001', 'QUEUED', null);
    await stream.publishStatus('request_00001', 'grading');
    await stream.publishToolStatus(
      'request_00001',
      'grade_answer',
      'started',
      null,
    );
    await stream.publishContent(
      'request_00001',
      'explanation',
      '正在整理批改说明。',
    );
    const resultEvent = await stream.publishResult('request_00001', result);
    await stream.publishCompleted(
      'request_00001',
      resultEvent.eventId,
      'not_applicable',
    );

    expect(store.events.every((event) => coachSseEventSchema.safeParse(event).success)).toBe(
      true,
    );
    expect(store.events.map((event) => event.sequence)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(store.events[1]).toMatchObject({
      type: 'status',
      payload: { label: '正在批改答案' },
    });
    expect(JSON.stringify(store.events)).not.toMatch(
      /systemPrompt|reasoning|answerKey|gradingRubric|authorization|bearer/i,
    );
  });

  it('requires result immediately before completed and seals terminal streams', async () => {
    const store = new MemoryEventStore();
    const stream = new CoachEventStreamService(store);
    await expect(
      stream.publishCompleted('request_00001', 'event_missing', 'not_saved'),
    ).rejects.toThrow();
    const resultEvent = await stream.publishResult('request_00001', result);
    await stream.publishCompleted(
      'request_00001',
      resultEvent.eventId,
      'not_applicable',
    );
    await expect(
      stream.publishStatus('request_00001', 'finalizing'),
    ).rejects.toThrow();
    await expect(
      stream.readAfter('request_00001', 'event_expired'),
    ).resolves.toBeNull();
  });

  it('supports safe cancelled/error/heartbeat envelopes', async () => {
    const cancelledStore = new MemoryEventStore();
    const cancelled = new CoachEventStreamService(cancelledStore);
    await cancelled.publishHeartbeat('request_00002');
    await cancelled.publishCancelled(
      'request_00002',
      'NOT_STARTED',
      '请求已取消，本次未保存学习记录。',
    );
    expect(cancelledStore.events.map((event) => event.type)).toEqual([
      'heartbeat',
      'cancelled',
    ]);

    const errorStore = new MemoryEventStore();
    const failed = new CoachEventStreamService(errorStore);
    await failed.publishError('request_00003', {
      code: 'MODEL_UNAVAILABLE',
      message: 'Coach 暂时不可用，请稍后重试。',
      retryable: true,
      retryAfterSeconds: 5,
      saveStatus: 'NOT_STARTED',
    });
    expect(coachSseEventSchema.safeParse(errorStore.events[0]).success).toBe(true);
  });
});
