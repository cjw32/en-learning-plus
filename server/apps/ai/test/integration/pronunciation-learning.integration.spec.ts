import {
  PronunciationLearningService,
  type PronunciationLearningAssessment,
  type PronunciationLearningRepository,
  type PronunciationLearningTransaction,
} from '@libs/learning/pronunciation/pronunciation-learning.service';

const assessment: PronunciationLearningAssessment = {
  assessmentId: 'assessment_1',
  subjectId: 'user-a',
  status: 'COMPLETED',
  confidence: 0.8,
  confidenceTier: 'RELIABLE',
  resultSchemaValid: true,
  audioValid: true,
  cancelled: false,
  timedOut: false,
  score: 90,
  evidenceHash: 'result-hash-1',
  resultSchemaVersion: 'pronunciation-result.v1',
  learningMappingVersion: 'pronunciation-quality.v1',
  schedulerVersion: 'SM2_V1',
  timezone: 'Asia/Shanghai',
  words: [
    {
      targetPosition: 0,
      word: 'hello',
      wordId: 'word-1',
      status: 'correct',
      score: 90,
      alignmentReliable: true,
    },
  ],
};

class MemoryRepository implements PronunciationLearningRepository {
  attempt: any = null;
  states = new Map<string, any>();
  events: any[] = [];
  learningWriteStatus = 'PENDING';
  failureStep: 'attempt' | 'state' | 'event' | 'status' | null = null;
  private queue = Promise.resolve();

  transaction<T>(
    operation: (tx: PronunciationLearningTransaction) => Promise<T>,
  ): Promise<T> {
    const run = this.queue.then(async () => {
      const snapshot = {
        attempt: structuredClone(this.attempt),
        states: structuredClone(this.states),
        events: structuredClone(this.events),
        learningWriteStatus: this.learningWriteStatus,
      };
      const fail = (step: MemoryRepository['failureStep']) => {
        if (this.failureStep === step) throw new Error(`fail:${step}`);
      };
      const tx: PronunciationLearningTransaction = {
        lockOwnedAssessment: jest.fn(async (subjectId, assessmentId) =>
          subjectId === assessment.subjectId &&
          assessmentId === assessment.assessmentId
            ? assessment
            : null,
        ),
        findAttemptByAssessment: jest.fn(async () => this.attempt),
        findItemState: jest.fn(
          async (_subjectId, targetKey) => this.states.get(targetKey) ?? null,
        ),
        createAttempt: jest.fn(async (value) => {
          fail('attempt');
          this.attempt = value;
        }),
        upsertItemState: jest.fn(async (value) => {
          fail('state');
          this.states.set(value.targetKey, value);
        }),
        createReviewEvent: jest.fn(async (value) => {
          fail('event');
          this.events.push(value);
        }),
        markLearningWriteStatus: jest.fn(async (_assessmentId, status) => {
          fail('status');
          this.learningWriteStatus = status;
        }),
      };
      try {
        return await operation(tx);
      } catch (error) {
        this.attempt = snapshot.attempt;
        this.states = snapshot.states;
        this.events = snapshot.events;
        this.learningWriteStatus = snapshot.learningWriteStatus;
        throw error;
      }
    });
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

describe('PronunciationLearningService transaction boundary', () => {
  it.each(['attempt', 'state', 'event', 'status'] as const)(
    'rolls back all learning facts after an injected %s failure',
    async (step) => {
      const repository = new MemoryRepository();
      repository.failureStep = step;
      const settlement = { recordLearningFinalized: jest.fn() };
      const service = new PronunciationLearningService(repository, settlement);
      await expect(
        service.save({
          subjectId: 'user-a',
          assessmentId: 'assessment_1',
          sourceValid: true,
          reviewedAt: new Date('2026-09-10T08:00:00.000Z'),
        }),
      ).rejects.toThrow(`fail:${step}`);
      expect(repository.attempt).toBeNull();
      expect(repository.states.size).toBe(0);
      expect(repository.events).toEqual([]);
      expect(settlement.recordLearningFinalized).not.toHaveBeenCalled();
    },
  );

  it('serializes concurrent replay to one attempt, event and finalization settlement', async () => {
    const repository = new MemoryRepository();
    const settlement = {
      recordLearningFinalized: jest.fn().mockResolvedValue(undefined),
    };
    let sequence = 0;
    const service = new PronunciationLearningService(
      repository,
      settlement,
      () => `id-${++sequence}`,
    );
    const results = await Promise.all([
      service.save({
        subjectId: 'user-a',
        assessmentId: 'assessment_1',
        sourceValid: true,
        reviewedAt: new Date('2026-09-10T08:00:00.000Z'),
      }),
      service.save({
        subjectId: 'user-a',
        assessmentId: 'assessment_1',
        sourceValid: true,
        reviewedAt: new Date('2026-09-10T08:00:00.000Z'),
      }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([
      'replayed',
      'saved',
    ]);
    expect(repository.attempt).toMatchObject({
      attemptType: 'PRONUNCIATION',
      exerciseId: null,
      submissionId: null,
      saveRequestId: null,
      pronunciationAssessmentId: 'assessment_1',
    });
    expect(repository.events).toHaveLength(1);
    expect(repository.events[0]).toMatchObject({
      targetType: 'PRONUNCIATION_WORD',
      evidenceKind: 'PRONUNCIATION_WORD',
      schedulerVersion: 'SM2_V1',
      policyVersion: 'pronunciation-quality.v1',
    });
    expect(settlement.recordLearningFinalized).toHaveBeenCalledTimes(1);
  });

  it('does not write an ineligible assessment', async () => {
    const repository = new MemoryRepository();
    const service = new PronunciationLearningService(repository);
    const ineligible = { ...assessment, confidence: 0.79 };
    const original = assessment.confidence;
    (assessment as { confidence: number }).confidence = ineligible.confidence;
    try {
      await expect(
        service.save({
          subjectId: 'user-a',
          assessmentId: 'assessment_1',
          sourceValid: true,
          reviewedAt: new Date('2026-09-10T08:00:00.000Z'),
        }),
      ).resolves.toMatchObject({ status: 'not_eligible' });
      expect(repository.attempt).toBeNull();
      expect(repository.states.size).toBe(0);
    } finally {
      (assessment as { confidence: number }).confidence = original;
    }
  });
});
