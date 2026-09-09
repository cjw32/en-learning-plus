import {
  CoachRequestService,
  CoachRequestStore,
  StoredCoachRequest,
} from '../../src/coach/api/coach-request.service';
import {
  CoachRequestRepository,
  toStoredCoachResult,
} from '../../src/coach/api/coach-request.repository';

class MemoryRequestStore implements CoachRequestStore {
  readonly requests: StoredCoachRequest[] = [];

  async isConversationOwned(subjectId: string, conversationId: string) {
    return subjectId === 'user-a' && conversationId === 'conversation-a';
  }

  async findByOwnerAndKey(subjectId: string, key: string) {
    return (
      this.requests.find(
        (request) =>
          request.subjectId === subjectId && request.clientRequestKey === key,
      ) ?? null
    );
  }

  async findActiveByConversation(conversationId: string) {
    return (
      this.requests.find(
        (request) =>
          request.conversationId === conversationId &&
          ['CREATED', 'QUEUED', 'RUNNING'].includes(request.status),
      ) ?? null
    );
  }

  async findById(requestId: string) {
    return this.requests.find((request) => request.id === requestId) ?? null;
  }

  async create(request: StoredCoachRequest) {
    this.requests.push(request);
    return request;
  }

  async update(request: StoredCoachRequest) {
    const index = this.requests.findIndex((item) => item.id === request.id);
    this.requests[index] = request;
    return request;
  }
}

describe('Coach request state and idempotency', () => {
  const input = {
    subjectId: 'user-a',
    conversationId: 'conversation-a',
    clientRequestKey: 'request-key-0001',
    body: { type: 'MESSAGE', message: 'Explain went.' },
  } as const;

  it('replays the same key/body and conflicts on a different body', async () => {
    const store = new MemoryRequestStore();
    const service = new CoachRequestService(store, () => 'request-a');

    const first = await service.create(input);
    const replay = await service.create(input);
    expect(replay).toEqual({ request: first.request, replayed: true });

    await expect(
      service.create({
        ...input,
        body: { type: 'MESSAGE', message: 'Changed' },
      }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect(store.requests).toHaveLength(1);
  });

  it('allows only documented transitions and keeps terminal states immutable', async () => {
    const store = new MemoryRequestStore();
    const service = new CoachRequestService(store, () => 'request-a');
    const created = (await service.create(input)).request;

    await expect(
      service.transition(created.id, 'RUNNING'),
    ).rejects.toMatchObject({
      code: 'STATE_CONFLICT',
    });
    await service.transition(created.id, 'QUEUED');
    await service.transition(created.id, 'RUNNING');
    await service.transition(created.id, 'COMPLETED');
    await expect(
      service.transition(created.id, 'FAILED'),
    ).rejects.toMatchObject({
      code: 'STATE_CONFLICT',
    });
  });

  it('allows only one active request per conversation', async () => {
    const store = new MemoryRequestStore();
    const service = new CoachRequestService(
      store,
      () => `request-${store.requests.length}`,
    );
    await service.create(input);

    await expect(
      service.create({ ...input, clientRequestKey: 'request-key-0002' }),
    ).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
  });

  it('durably retains the validated exercise submission for request-id-only jobs', async () => {
    const store = new MemoryRequestStore();
    const service = new CoachRequestService(store, () => 'request-grade-a');
    const body = {
      type: 'EXERCISE_SUBMISSION' as const,
      exerciseId: 'exercise_00001',
      answers: [{ itemId: 'exercise_item_00001', answer: 'went' }],
    };
    const created = await service.create({
      subjectId: 'user-a',
      conversationId: 'conversation-a',
      clientRequestKey: 'grading-key-00001',
      body,
    });
    expect(created.request.inputPayload).toEqual(body);
    expect(created.request.inputPayload).not.toHaveProperty('userId');
  });

  it('stores v2 results as citation IDs and claims without dynamic evidence', async () => {
    const publicResult = {
      schemaVersion: 'coach.result.v2',
      responseType: 'answer',
      correction: '',
      explanation: 'A harbor is a sheltered place for boats.',
      examples: [],
      errorTypes: [],
      score: null,
      nextAction: 'continue',
      nextActionReason: 'Continue learning.',
      traceId: 'trace_storage_v2_000001',
      knowledgeStatus: 'grounded',
      groundedClaims: [
        {
          claimId: 'claim_storage_000001',
          resultPath: '/explanation',
          text: 'A harbor is a sheltered place for boats.',
          citationIds: ['cit_storage_v2_000001'],
        },
      ],
      citations: [
        {
          citationId: 'cit_storage_v2_000001',
          status: 'active',
          source: 'synthetic-word-source',
          title: 'harbor',
          category: 'WORD_MEANING',
          excerpt: 'PRIVATE_DYNAMIC_EXCERPT_CANARY',
          accessScope: 'PRIVATE_OWNER',
          locator: null,
        },
      ],
    } as const;
    const stored = toStoredCoachResult(publicResult);
    expect(stored).toMatchObject({
      schemaVersion: 'coach.result.v2',
      citationIds: ['cit_storage_v2_000001'],
      groundedClaims: publicResult.groundedClaims,
    });
    expect(JSON.stringify(stored)).not.toMatch(
      /PRIVATE_DYNAMIC_EXCERPT_CANARY|excerpt|locator|private-learning-summary/i,
    );

    const requestWrite = jest.fn().mockResolvedValue({ count: 1 });
    const messageWrite = jest.fn().mockResolvedValue({});
    const transaction = {
      coachRequest: { updateMany: requestWrite },
      coachMessage: { create: messageWrite },
      coachConversation: { update: jest.fn().mockResolvedValue({}) },
    };
    const repository = new CoachRequestRepository({
      $transaction: async (work: (tx: typeof transaction) => unknown) =>
        work(transaction),
    } as never);
    await repository.completeExecution({
      request: {
        id: 'request-storage-v2',
        subjectId: 'user-a',
        conversationId: 'conversation-a',
        clientRequestKey: 'storage-v2',
        requestBodyHash: 'hash',
        inputPayload: { type: 'MESSAGE', message: 'Explain harbor.' },
        retryOfRequestId: null,
        errorCode: null,
        inputType: 'MESSAGE',
        status: 'RUNNING',
        deadlineAt: new Date('2026-09-09T00:01:00.000Z'),
        createdAt: new Date('2026-09-09T00:00:00.000Z'),
        updatedAt: new Date('2026-09-09T00:00:00.000Z'),
        queuedAt: new Date('2026-09-09T00:00:00.000Z'),
        startedAt: new Date('2026-09-09T00:00:01.000Z'),
        finishedAt: null,
        cancelRequestedAt: null,
      },
      intent: 'ANSWER',
      result: publicResult,
      promptVersion: 'prompt.test.v1',
      modelVersion: 'model.test.v1',
      budgetVersion: 'budget.test.v1',
      finishedAt: new Date('2026-09-09T00:00:02.000Z'),
    });
    const persistedJson = JSON.stringify([
      requestWrite.mock.calls[0]?.[0]?.data?.finalResult,
      messageWrite.mock.calls.at(-1)?.[0]?.data?.structuredResult,
    ]);
    expect(persistedJson).toContain('cit_storage_v2_000001');
    expect(persistedJson).not.toMatch(
      /PRIVATE_DYNAMIC_EXCERPT_CANARY|excerpt|locator|private-learning-summary/i,
    );
  });
});
