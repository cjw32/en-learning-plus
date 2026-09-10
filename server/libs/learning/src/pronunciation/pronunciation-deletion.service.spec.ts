import { PronunciationLearningDeletionService } from './pronunciation-deletion.service';

type Event = {
  id: string;
  attemptId: string;
  quality: number;
  reviewedAt: Date;
  schedulerVersion: 'SM2_V1';
};

const events: Event[] = [
  {
    id: 'e1',
    attemptId: 'a1',
    quality: 2,
    reviewedAt: new Date('2026-09-01T00:00:00Z'),
    schedulerVersion: 'SM2_V1',
  },
  {
    id: 'e2',
    attemptId: 'a2',
    quality: 5,
    reviewedAt: new Date('2026-09-02T00:00:00Z'),
    schedulerVersion: 'SM2_V1',
  },
  {
    id: 'e3',
    attemptId: 'a3',
    quality: 4,
    reviewedAt: new Date('2026-09-03T00:00:00Z'),
    schedulerVersion: 'SM2_V1',
  },
];

describe('PronunciationLearningDeletionService', () => {
  it.each([
    ['earliest', 'a1'],
    ['middle', 'a2'],
    ['latest', 'a3'],
  ])(
    'replays remaining evidence after deleting the %s attempt',
    async (_label, deletedAttemptId) => {
      const saveRecalculation = jest.fn(async (input: unknown) => input);
      const repository = {
        compensate: jest.fn(async (_deletionId: string, operation: any) =>
          operation({
            loadAffectedItems: jest.fn(async () => [
              {
                itemStateId: 'state-1',
                subjectId: 'user-a',
                targetKey: 'word-1',
                wordId: 'word-1',
                currentState: {
                  reviewState: 'REVIEW',
                  repetitionCount: 2,
                  easeFactor: 2.5,
                  intervalDays: 6,
                },
                events,
              },
            ]),
            saveRecalculation,
          }),
        ),
      };
      const invalidation = { invalidate: jest.fn(async () => undefined) };
      const service = new PronunciationLearningDeletionService(
        repository as never,
        invalidation,
      );

      const result = await service.compensate({
        deletionId: `delete-${deletedAttemptId}`,
        deletedAttemptId,
        reviewedTimezone: 'UTC',
      });

      expect(result.status).toBe('COMPENSATED');
      expect(result.items).toHaveLength(1);
      expect(result.items[0].replayedEventCount).toBe(2);
      expect(result.items[0].sourceAttemptHash).not.toContain(deletedAttemptId);
      const lastRemaining = events
        .filter((event) => event.attemptId !== deletedAttemptId)
        .at(-1)!;
      expect(saveRecalculation).toHaveBeenCalledWith(
        expect.objectContaining({
          lastReviewedAt: lastRemaining.reviewedAt,
          lastQuality: lastRemaining.quality,
          lastAttemptId: lastRemaining.attemptId,
        }),
      );
      expect(invalidation.invalidate).toHaveBeenCalledTimes(1);
    },
  );

  it('does not invalidate summaries when the compensation transaction fails', async () => {
    const invalidation = { invalidate: jest.fn() };
    const service = new PronunciationLearningDeletionService(
      {
        compensate: jest.fn(async () => Promise.reject(new Error('rollback'))),
      } as never,
      invalidation,
    );

    await expect(
      service.compensate({
        deletionId: 'delete-failed',
        deletedAttemptId: 'a2',
        reviewedTimezone: 'UTC',
      }),
    ).rejects.toThrow('rollback');
    expect(invalidation.invalidate).not.toHaveBeenCalled();
  });
});
