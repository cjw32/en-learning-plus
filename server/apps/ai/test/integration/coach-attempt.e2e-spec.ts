import {
  AttemptService,
  type AttemptRepository,
  type AttemptTransaction,
  type AttemptTransactionState,
} from '@libs/learning';

function initialState(): AttemptTransactionState {
  return {
    submission: {
      id: 'submission_00001',
      subjectId: 'user-a',
      exerciseId: 'exercise_00001',
      status: 'GRADED_VALID',
      score: 70,
      gradingHash: 'a'.repeat(64),
      errorTypes: ['TENSE'],
      timezone: 'Asia/Shanghai',
      targetEvidence: [
        {
          targetType: 'WORD',
          targetKey: 'word-1',
          wordId: 'word-1',
          quality: 4,
        },
        {
          targetType: 'WORD',
          targetKey: 'word-1',
          wordId: 'word-1',
          quality: 2,
        },
        {
          targetType: 'ERROR_TYPE',
          targetKey: 'TENSE',
          wordId: null,
          quality: 3,
        },
      ],
    },
    attempts: [],
    itemStates: [],
    reviewEvents: [],
  };
}

class MemoryAttemptRepository implements AttemptRepository {
  state = initialState();
  failAfterEvent = false;

  async transaction<T>(operation: (tx: AttemptTransaction) => Promise<T>) {
    const before = structuredClone(this.state);
    const tx: AttemptTransaction = {
      lockOwnedSubmission: async (subjectId, submissionId) =>
        this.state.submission.subjectId === subjectId &&
        this.state.submission.id === submissionId
          ? this.state.submission
          : null,
      findAttemptBySubmission: async (submissionId) =>
        this.state.attempts.find(
          (attempt) => attempt.submissionId === submissionId,
        ) ?? null,
      findItemState: async (subjectId, targetType, targetKey) =>
        this.state.itemStates.find(
          (item) =>
            item.subjectId === subjectId &&
            item.targetType === targetType &&
            item.targetKey === targetKey,
        ) ?? null,
      createAttempt: async (attempt) => {
        this.state.attempts.push(attempt);
      },
      upsertItemState: async (state) => {
        const index = this.state.itemStates.findIndex(
          (item) =>
            item.subjectId === state.subjectId &&
            item.targetType === state.targetType &&
            item.targetKey === state.targetKey,
        );
        if (index === -1) this.state.itemStates.push(state);
        else this.state.itemStates[index] = state;
      },
      createReviewEvent: async (event) => {
        this.state.reviewEvents.push(event);
        if (this.failAfterEvent) throw new Error('injected event failure');
      },
      markSaved: async () => {
        this.state.submission.status = 'SAVED';
      },
    };
    try {
      return await operation(tx);
    } catch (error) {
      this.state = before;
      throw error;
    }
  }
}

const input = {
  subjectId: 'user-a',
  submissionId: 'submission_00001',
  gradingHash: 'a'.repeat(64),
  saveRequestId: 'request_save_0001',
  idempotencyKey: 'save-key-0000001',
  reviewedAt: new Date('2026-09-02T02:00:00.000Z'),
};

describe('AttemptService atomic save and replay', () => {
  it('writes one attempt and one event per target, then replays all retries', async () => {
    const repository = new MemoryAttemptRepository();
    const service = new AttemptService(repository, () => 'attempt_00001');

    const first = await service.save(input);
    for (const retrySource of [
      'double-click',
      'network',
      'sse-reconnect',
      'queue-redelivery',
    ]) {
      expect(retrySource).toBeTruthy();
      expect(await service.save(input)).toMatchObject({ status: 'replayed' });
    }

    expect(first.status).toBe('saved');
    expect(repository.state.attempts).toHaveLength(1);
    expect(repository.state.reviewEvents).toHaveLength(2);
    expect(repository.state.itemStates).toHaveLength(2);
    expect(
      repository.state.reviewEvents.find(
        (event) => event.targetKey === 'word-1',
      )?.quality,
    ).toBe(2);
  });

  it('rejects hash mismatch and cancellation before any write', async () => {
    const repository = new MemoryAttemptRepository();
    const service = new AttemptService(repository);
    await expect(
      service.save({ ...input, gradingHash: 'b'.repeat(64) }),
    ).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    await expect(
      service.save({ ...input, cancelled: true }),
    ).rejects.toMatchObject({
      code: 'STATE_CONFLICT',
    });
    expect(repository.state.attempts).toHaveLength(0);
  });

  it('rolls back attempt, events, aggregates, and statuses on an injected failure', async () => {
    const repository = new MemoryAttemptRepository();
    repository.failAfterEvent = true;
    const service = new AttemptService(repository);
    await expect(service.save(input)).rejects.toThrow('injected event failure');
    expect(repository.state).toEqual(initialState());
  });
});
