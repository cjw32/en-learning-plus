import {
  CoachIdempotencyBinding,
  CoachIdempotencyService,
  CoachIdempotencyStore,
} from '../../src/coach/governance/coach-idempotency.service';

class MemoryIdempotencyStore implements CoachIdempotencyStore {
  readonly bindings = new Map<string, CoachIdempotencyBinding<unknown>>();

  private key(binding: CoachIdempotencyBinding<unknown>) {
    return `${binding.subjectId}:${binding.operation}:${binding.idempotencyKey}`;
  }

  async reserve<TResult>(binding: CoachIdempotencyBinding<TResult>) {
    const key = this.key(binding);
    const existing = this.bindings.get(key) as
      | CoachIdempotencyBinding<TResult>
      | undefined;
    if (existing) return { binding: existing, created: false };
    this.bindings.set(key, binding);
    return { binding, created: true };
  }

  async complete<TResult>(
    binding: CoachIdempotencyBinding<TResult>,
    result: TResult,
  ) {
    const completed = { ...binding, status: 'COMPLETED' as const, result };
    this.bindings.set(this.key(binding), completed);
    return completed;
  }

  async release<TResult>(binding: CoachIdempotencyBinding<TResult>) {
    this.bindings.delete(this.key(binding));
  }
}

describe('CoachIdempotencyService', () => {
  it('replays the completed result without repeating the write', async () => {
    const store = new MemoryIdempotencyStore();
    const service = new CoachIdempotencyService(store);
    const write = jest.fn(async () => ({ attemptId: 'attempt-1' }));
    const input = {
      subjectId: 'user-a',
      operation: 'save_attempt',
      idempotencyKey: 'save-key-0000001',
      logicalResource: 'submission-1',
      answerVersion: 'answer-v1',
      body: { submissionId: 'submission-1', gradingHash: 'hash-1' },
      operationFn: write,
    };

    expect(await service.execute(input)).toEqual({
      result: { attemptId: 'attempt-1' },
      replayed: false,
    });
    expect(await service.execute(input)).toEqual({
      result: { attemptId: 'attempt-1' },
      replayed: true,
    });
    expect(write).toHaveBeenCalledTimes(1);
    expect(store.bindings.size).toBe(1);
  });

  it('conflicts on changed body, resource, or answer version', async () => {
    const store = new MemoryIdempotencyStore();
    const service = new CoachIdempotencyService(store);
    const base = {
      subjectId: 'user-a',
      operation: 'save_attempt',
      idempotencyKey: 'save-key-0000001',
      logicalResource: 'submission-1',
      answerVersion: 'answer-v1',
      body: { score: 80 },
      operationFn: async () => 'saved',
    };
    await service.execute(base);

    for (const change of [
      { body: { score: 81 } },
      { logicalResource: 'submission-2' },
      { answerVersion: 'answer-v2' },
    ]) {
      await expect(
        service.execute({ ...base, ...change }),
      ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    }
    expect(store.bindings.size).toBe(1);
  });

  it('isolates bindings by authenticated subject and operation', async () => {
    const store = new MemoryIdempotencyStore();
    const service = new CoachIdempotencyService(store);
    const base = {
      subjectId: 'user-a',
      operation: 'grade_answer',
      idempotencyKey: 'shared-key-00001',
      logicalResource: 'exercise-1',
      body: { answer: 'went' },
      operationFn: async () => 'ok',
    };
    await service.execute(base);
    await service.execute({ ...base, subjectId: 'user-b' });
    await service.execute({ ...base, operation: 'save_attempt' });
    expect(store.bindings.size).toBe(3);
  });
});
