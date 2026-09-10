import { PronunciationLearningDeletionService } from '@libs/learning';

describe('pronunciation private-summary invalidation ordering', () => {
  it('emits invalidation only after compensation commits', async () => {
    const order: string[] = [];
    const service = new PronunciationLearningDeletionService(
      {
        compensate: jest.fn(async (_id, operation) => {
          const result = await operation({
            loadAffectedItems: jest.fn(async () => []),
            saveRecalculation: jest.fn(),
          });
          order.push('commit');
          return result;
        }),
      },
      { invalidate: jest.fn(async () => order.push('invalidate')) },
    );

    await service.compensate({
      deletionId: 'delete_00001',
      deletedAttemptId: 'attempt_00001',
      reviewedTimezone: 'UTC',
    });

    expect(order).toEqual(['commit']);
  });

  it('invalidates affected topics after a committed recalculation', async () => {
    const order: string[] = [];
    const invalidation = {
      invalidate: jest.fn(async () => order.push('invalidate')),
    };
    const service = new PronunciationLearningDeletionService(
      {
        compensate: jest.fn(async (_id, operation) => {
          const result = await operation({
            loadAffectedItems: jest.fn(async () => [
              {
                itemStateId: 'state-1',
                subjectId: 'user-a',
                targetKey: 'word-1',
                wordId: 'word-1',
                currentState: {
                  reviewState: 'LEARNING',
                  repetitionCount: 0,
                  easeFactor: 2.3,
                  intervalDays: 1,
                },
                events: [],
              },
            ]),
            saveRecalculation: jest.fn(async () => undefined),
          });
          order.push('commit');
          return result;
        }),
      },
      invalidation,
    );

    await service.compensate({
      deletionId: 'delete_00001',
      deletedAttemptId: 'attempt_00001',
      reviewedTimezone: 'UTC',
    });

    expect(order).toEqual(['commit', 'invalidate']);
    expect(invalidation.invalidate).toHaveBeenCalledWith({
      deletionId: 'delete_00001',
      subjectId: 'user-a',
      targetKeys: ['word-1'],
    });
  });
});
