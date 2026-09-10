import {
  InMemoryPronunciationAdmissionStore,
  PronunciationAdmissionError,
  PronunciationAdmissionService,
} from '../../src/pronunciation/governance/pronunciation-admission.service';

describe('pronunciation admission', () => {
  let now = 0;
  let service: PronunciationAdmissionService;

  beforeEach(() => {
    now = 0;
    service = new PronunciationAdmissionService(
      new InMemoryPronunciationAdmissionStore(),
      () => now,
    );
  });

  it('allows exactly one active assessment and expires its lease', async () => {
    await service.admit({
      subjectId: 'user-1',
      assessmentId: 'assessment-1',
      activeTtlSeconds: 30,
    });
    await expect(
      service.admit({
        subjectId: 'user-1',
        assessmentId: 'assessment-2',
        activeTtlSeconds: 30,
      }),
    ).rejects.toMatchObject({ code: 'CONCURRENCY_LIMITED' });
    now = 30_000;
    await expect(
      service.admit({
        subjectId: 'user-1',
        assessmentId: 'assessment-3',
        activeTtlSeconds: 30,
      }),
    ).resolves.toBeDefined();
  });

  it('allows exactly six per minute and resets at the window boundary', async () => {
    for (let index = 0; index < 6; index += 1) {
      const lease = await service.admit({
        subjectId: 'user-1',
        assessmentId: `assessment-${index}`,
        activeTtlSeconds: 30,
      });
      await lease.release();
    }
    await expect(
      service.admit({
        subjectId: 'user-1',
        assessmentId: 'assessment-7',
        activeTtlSeconds: 30,
      }),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED', retryAfterSeconds: 60 });
    now = 60_000;
    await expect(
      service.admit({
        subjectId: 'user-1',
        assessmentId: 'assessment-8',
        activeTtlSeconds: 30,
      }),
    ).resolves.toBeDefined();
  });

  it('allows exactly 120 per day across minute windows', async () => {
    for (let index = 0; index < 120; index += 1) {
      now = Math.floor(index / 6) * 60_000;
      const lease = await service.admit({
        subjectId: 'user-1',
        assessmentId: `assessment-${index}`,
        activeTtlSeconds: 30,
      });
      await lease.release();
    }
    now = 20 * 60_000;
    await expect(
      service.admit({
        subjectId: 'user-1',
        assessmentId: 'assessment-121',
        activeTtlSeconds: 30,
      }),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    now = 86_400_000;
    await expect(
      service.admit({
        subjectId: 'user-1',
        assessmentId: 'assessment-next-day',
        activeTtlSeconds: 30,
      }),
    ).resolves.toBeDefined();
  });

  it('rolls back both counters and the lease after downstream failure', async () => {
    const lease = await service.admit({
      subjectId: 'user-1',
      assessmentId: 'assessment-rollback',
      activeTtlSeconds: 30,
    });
    await lease.rollback();
    for (let index = 0; index < 6; index += 1) {
      const accepted = await service.admit({
        subjectId: 'user-1',
        assessmentId: `assessment-${index}`,
        activeTtlSeconds: 30,
      });
      await accepted.release();
    }
  });

  it('treats PostgreSQL partial-unique rejection as the durable fallback authority', async () => {
    const store = new InMemoryPronunciationAdmissionStore();
    service = new PronunciationAdmissionService(store, () => now);
    await expect(
      service.admit({
        subjectId: 'user-1',
        assessmentId: 'assessment-conflict',
        activeTtlSeconds: 30,
        confirmDurableClaim: async () => {
          throw Object.assign(new Error('unique constraint'), {
            code: 'P2002',
          });
        },
      }),
    ).rejects.toEqual(
      new PronunciationAdmissionError('CONCURRENCY_LIMITED', 1),
    );

    await expect(
      service.admit({
        subjectId: 'user-1',
        assessmentId: 'assessment-after-conflict',
        activeTtlSeconds: 30,
      }),
    ).resolves.toBeDefined();
  });
});
