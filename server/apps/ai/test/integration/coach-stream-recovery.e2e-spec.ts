import {
  CoachExecutionContext,
  createCoachExecutionContext,
} from '@libs/shared';
import type { CoachSseEvent } from '@en/common/coach';
import {
  CoachCancellationService,
  type CoachCancellationRepository,
  type CoachCancellationSignalStore,
} from '../../src/coach/governance/coach-cancellation.service';
import { CoachRetryService } from '../../src/coach/governance/coach-retry.service';
import {
  CoachEventStreamService,
  type CoachEventAppend,
  type CoachEventStore,
} from '../../src/coach/streaming/coach-event-stream.service';
import {
  CoachSseSessionService,
  type CoachSseAccessRepository,
} from '../../src/coach/streaming/coach-sse-session.service';
import { CoachControlledStepRunner } from '../../src/coach/workflow/coach.graph';

class SharedEventStore implements CoachEventStore {
  readonly events: CoachSseEvent[] = [];
  async append(input: CoachEventAppend) {
    const event = {
      schemaVersion: 'coach.sse.v1' as const,
      eventId: `event_${this.events.length}`,
      requestId: input.requestId,
      sequence: this.events.length,
      timestamp: input.timestamp.toISOString(),
      type: input.type,
      payload: input.payload,
    } as CoachSseEvent;
    this.events.push(event);
    return event;
  }
  async readAfter(_requestId: string, lastEventId?: string) {
    const events = this.events.filter(
      (event) => event.requestId === _requestId,
    );
    if (!lastEventId) return events;
    const index = events.findIndex((event) => event.eventId === lastEventId);
    return index < 0 ? null : events.slice(index + 1);
  }
  async purgeRequest(requestId: string) {
    for (let index = this.events.length - 1; index >= 0; index -= 1) {
      if (this.events[index]?.requestId === requestId) {
        this.events.splice(index, 1);
      }
    }
  }
}

const context = createCoachExecutionContext(
  { userId: 'user-a', tokenType: 'access', exp: 1_788_307_260 },
  1_788_307_200,
);

function accessRepository(
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' = 'RUNNING',
) {
  const repository: CoachSseAccessRepository = {
    async findOwned(subjectId, requestId) {
      return subjectId === 'user-a' && requestId === 'request_00001'
        ? { id: requestId, status, finalResult: null }
        : null;
    },
  };
  return repository;
}

describe('Coach stream replay and cancellation recovery', () => {
  it('replays across service instances and deduplicates duplicate event IDs', async () => {
    const shared = new SharedEventStore();
    const writer = new CoachEventStreamService(shared);
    const reader = new CoachEventStreamService({
      ...shared,
      append: shared.append.bind(shared),
      async readAfter(requestId, lastEventId) {
        const events = await shared.readAfter(requestId, lastEventId);
        return events ? [...events, ...events] : null;
      },
    });
    await writer.publishStatus('request_00001', 'validating');
    await writer.publishStatus('request_00001', 'understanding');
    const session = new CoachSseSessionService(
      accessRepository(),
      reader,
      () => 1_788_307_200,
    );
    const opened = await session.open(context, 'request_00001');
    expect(opened.mode).toBe('stream');
    expect(opened.events.map((event) => event.eventId)).toEqual([
      'event_0',
      'event_1',
    ]);
  });

  it('returns 410 semantics for an expired replay cursor', async () => {
    const session = new CoachSseSessionService(
      accessRepository(),
      new CoachEventStreamService(new SharedEventStore()),
      () => 1_788_307_200,
    );
    await expect(
      session.open(context, 'request_00001', 'expired-event'),
    ).rejects.toMatchObject({ status: 410 });
  });

  it('rejects expired access tokens and hides foreign requests', async () => {
    const session = new CoachSseSessionService(
      accessRepository(),
      new CoachEventStreamService(new SharedEventStore()),
      () => 1_788_307_200,
    );
    await expect(
      session.open(
        new CoachExecutionContext('user-a', 1_788_307_199),
        'request_00001',
      ),
    ).rejects.toMatchObject({ status: 401 });
    await expect(session.open(context, 'request_user_b')).rejects.toMatchObject(
      { status: 404 },
    );
  });

  it('falls back to durable reconciliation when Redis is unavailable', async () => {
    const broken: CoachEventStore = {
      async append() {
        throw new Error('redis secret host');
      },
      async readAfter() {
        throw new Error('redis secret host');
      },
    };
    const session = new CoachSseSessionService(
      accessRepository('COMPLETED'),
      new CoachEventStreamService(broken),
      () => 1_788_307_200,
    );
    await expect(session.open(context, 'request_00001')).resolves.toMatchObject(
      {
        mode: 'reconcile',
        request: { status: 'COMPLETED' },
      },
    );
  });

  it('reprojects v2 result events on replay instead of returning stale excerpts', async () => {
    const shared = new SharedEventStore();
    const writer = new CoachEventStreamService(shared);
    const staleResult = {
      schemaVersion: 'coach.result.v2',
      responseType: 'answer',
      correction: '',
      explanation: 'Historical explanation.',
      examples: [],
      errorTypes: [],
      score: null,
      nextAction: 'continue',
      nextActionReason: 'Continue.',
      traceId: 'trace_stream_v2_000001',
      knowledgeStatus: 'grounded',
      groundedClaims: [
        {
          claimId: 'claim_stream_v2_000001',
          resultPath: '/explanation',
          text: 'Historical explanation.',
          citationIds: ['cit_stream_v2_000001'],
        },
      ],
      citations: [
        {
          citationId: 'cit_stream_v2_000001',
          status: 'active',
          source: 'stale-source',
          title: 'Stale title',
          category: 'WORD_MEANING',
          excerpt: 'STALE_STREAM_EXCERPT_CANARY',
          accessScope: 'PUBLIC',
          locator: null,
        },
      ],
    } as const;
    await writer.publishResult('request_00001', staleResult);
    expect(JSON.stringify(shared.events)).not.toContain(
      'STALE_STREAM_EXCERPT_CANARY',
    );
    const projector = {
      projectResult: jest.fn(async (_subjectId, input) => ({
        ...input,
        citations: [
          {
            citationId: 'cit_stream_v2_000001',
            status: 'unavailable',
            reason: 'SOURCE_UNAVAILABLE',
          },
        ],
      })),
    };
    const reader = new CoachEventStreamService(shared, projector as never);
    const session = new CoachSseSessionService(
      accessRepository('COMPLETED'),
      reader,
      () => 1_788_307_200,
    );
    const opened = await session.open(context, 'request_00001');
    expect(projector.projectResult).toHaveBeenCalledWith(
      'user-a',
      expect.objectContaining({
        citations: [
          {
            citationId: 'cit_stream_v2_000001',
            status: 'unavailable',
            reason: 'SOURCE_UNAVAILABLE',
          },
        ],
      }),
    );
    expect(JSON.stringify(opened.events)).not.toContain(
      'STALE_STREAM_EXCERPT_CANARY',
    );
  });

  it('purges replay by request or citation without affecting unrelated streams', async () => {
    const shared = new SharedEventStore();
    const writer = new CoachEventStreamService(shared);
    await writer.publishStatus('request_00001', 'validating');
    await writer.publishStatus('request_00002', 'validating');
    const replayLookup = {
      findRequestIdsByCitationIds: jest.fn(async () => ['request_00001']),
    };
    const stream = new CoachEventStreamService(shared, undefined, replayLookup);
    await stream.purgeAffected({
      requestIds: [],
      citationIds: ['cit_stream_purge_000001'],
    });
    await expect(stream.readAfter('request_00001')).resolves.toEqual([]);
    await expect(stream.readAfter('request_00002')).resolves.toHaveLength(1);
    expect(replayLookup.findRequestIdsByCitationIds).toHaveBeenCalledWith([
      'cit_stream_purge_000001',
    ]);
  });

  it('propagates cancellation and reports the actual write-commit boundary', async () => {
    let attemptSaved = false;
    let cancelled = false;
    const repository: CoachCancellationRepository = {
      async findOwned(subjectId, requestId) {
        return subjectId === 'user-a' && requestId === 'request_00001'
          ? { id: requestId, status: 'RUNNING', attemptSaved }
          : null;
      },
      async markCancellationRequested() {
        cancelled = true;
      },
    };
    const signalled = new Set<string>();
    const signals: CoachCancellationSignalStore = {
      async set(requestId) {
        signalled.add(requestId);
      },
      async has(requestId) {
        return signalled.has(requestId);
      },
    };
    const service = new CoachCancellationService(repository, signals);
    const abort = service.abortSignalFor('request_00001');
    await expect(
      service.cancel(context, 'request_00001', 'cancel-key-000001'),
    ).resolves.toMatchObject({ saveStatus: 'NOT_SAVED' });
    expect(cancelled).toBe(true);
    expect(abort.aborted).toBe(true);

    attemptSaved = true;
    await expect(
      service.cancel(context, 'request_00001', 'cancel-key-000001'),
    ).resolves.toMatchObject({ saveStatus: 'SAVED_ONCE' });
  });

  it('replays completed requests and creates lineage only for retryable terminal failures', async () => {
    const source = {
      id: 'request_00001',
      userId: 'user-a',
      conversationId: 'conversation-a',
      status: 'COMPLETED',
      inputPayload: { type: 'MESSAGE', message: 'Explain went.' },
      errorCode: null,
    };
    const repository = {
      findOwnedRequest: jest.fn(async () => source),
    };
    const requests = {
      create: jest.fn(async (input) => ({
        replayed: false,
        request: {
          id: 'request_retry_01',
          conversationId: input.conversationId,
          status: 'CREATED',
        },
      })),
      transition: jest.fn(async (_id, status) => ({
        id: 'request_retry_01',
        conversationId: 'conversation-a',
        status,
      })),
    };
    const stream = { publishConnected: jest.fn() };
    const service = new CoachRetryService(
      repository as never,
      requests as never,
      stream as never,
    );
    await expect(
      service.retry(context, source.id, 'retry-key-000001'),
    ).resolves.toMatchObject({ replayed: true, request: source });
    expect(requests.create).not.toHaveBeenCalled();

    source.status = 'FAILED';
    source.errorCode = 'MODEL_UNAVAILABLE';
    await expect(
      service.retry(context, source.id, 'retry-key-000002'),
    ).resolves.toMatchObject({
      replayed: false,
      request: { id: 'request_retry_01', status: 'QUEUED' },
    });
    expect(requests.create).toHaveBeenCalledWith(
      expect.objectContaining({ retryOfRequestId: source.id }),
    );

    requests.create.mockResolvedValueOnce({
      replayed: true,
      request: {
        id: 'request_retry_01',
        conversationId: 'conversation-a',
        status: 'QUEUED',
      },
    });
    await expect(
      service.retry(context, source.id, 'retry-key-000002'),
    ).resolves.toMatchObject({
      replayed: true,
      request: { id: 'request_retry_01', status: 'QUEUED' },
    });

    source.status = 'BUDGET_EXCEEDED';
    source.errorCode = 'BUDGET_EXCEEDED';
    await expect(
      service.retry(context, source.id, 'retry-key-000003'),
    ).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
  });

  it.each(['model', 'tool'] as const)(
    'propagates cancellation to a running %s and ignores its late result',
    async (kind) => {
      const controller = new AbortController();
      const cancellation = {
        observe: jest.fn(async () => false),
        abortSignalFor: jest.fn(() => controller.signal),
      };
      const stream = {
        publishStatus: jest.fn(),
        publishToolStatus: jest.fn(),
      };
      const onSuccess = jest.fn();
      let received: AbortSignal | undefined;
      const runner = new CoachControlledStepRunner(
        stream as never,
        cancellation as never,
      );
      const execution = runner.execute({
        requestId: 'request_00001',
        status: kind === 'model' ? 'generating' : 'grading',
        tool: kind === 'tool' ? 'grade_answer' : undefined,
        timeoutMs: 1000,
        async operation(signal) {
          received = signal;
          await new Promise((resolve) => setTimeout(resolve, 5));
          return result;
        },
        onSuccess,
      });
      controller.abort();
      await expect(execution).rejects.toMatchObject({ code: 'CANCELLED' });
      expect(received?.aborted).toBe(true);
      expect(onSuccess).not.toHaveBeenCalled();
    },
  );

  it('aborts a timed-out step and never publishes its late result', async () => {
    const cancellation = {
      observe: jest.fn(async () => false),
      abortSignalFor: jest.fn(() => new AbortController().signal),
    };
    const onSuccess = jest.fn();
    let received: AbortSignal | undefined;
    const runner = new CoachControlledStepRunner(
      { publishStatus: jest.fn(), publishToolStatus: jest.fn() } as never,
      cancellation as never,
    );
    await expect(
      runner.execute({
        requestId: 'request_00001',
        status: 'generating',
        timeoutMs: 1,
        async operation(signal) {
          received = signal;
          await new Promise((resolve) => setTimeout(resolve, 5));
          return result;
        },
        onSuccess,
      }),
    ).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' });
    expect(received?.aborted).toBe(true);
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
