import {
  CoachRequestService,
  CoachRequestStore,
  StoredCoachRequest,
} from '../../src/coach/api/coach-request.service';

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
});
