import type { PronunciationResult } from '@en/common/pronunciation';
import { PronunciationRepository } from '../../src/pronunciation/application/pronunciation.repository';
const result: PronunciationResult = {
  schemaVersion: 'pronunciation-result.v1',
  assessmentId: 'assessment_1',
  referenceText: 'hello',
  recognizedText: 'hello',
  scores: {
    overall: 90,
    accuracy: 90,
    completeness: 100,
    fluency: 88,
    prosody: null,
  },
  confidence: 0.8,
  confidenceTier: 'RELIABLE',
  words: [
    {
      sequence: 0,
      targetPosition: 0,
      word: 'hello',
      normalizedWord: 'hello',
      startMs: 0,
      endMs: 500,
      score: 90,
      status: 'correct',
      feedback: null,
    },
  ],
  summary: '发音清晰。',
  suggestions: ['继续练习。'],
  nextAction: 'continue',
  provider: 'fake',
  modelVersion: 'fake-v1',
  learningUpdate: { status: 'NOT_ELIGIBLE', changedItems: [] },
  audio: { available: true, expiresAt: '2026-09-11T00:00:00.000Z' },
  versions: {
    providerAdapter: 'fake-adapter.v1',
    providerApi: 'fake-api.v1',
    normalization: 'pronunciation-normalization.v1',
    alignment: 'pronunciation-alignment.v1',
    assessmentRule: 'pronunciation-assessment.v1',
    confidencePolicy: 'pronunciation-confidence.v1',
    learningMapping: 'pronunciation-quality.v1',
    scheduler: 'SM2_V1',
    budget: 'budget-v1',
    price: 'price-v1',
  },
  traceId: 'trace_1',
};

describe('pronunciation participation is saved with a valid result', () => {
  function setup(count = 1) {
    const tx = {
      pronunciationTarget: {
        findFirst: jest.fn().mockResolvedValue({ wordId: null }),
      },
      pronunciationAssessment: {
        updateMany: jest.fn().mockResolvedValue({ count }),
      },
      pronunciationWordAssessment: {
        deleteMany: jest.fn(),
        createMany: jest.fn(),
      },
      $executeRaw: jest.fn().mockResolvedValue(1),
      user: { update: jest.fn() },
    };
    const repo = new PronunciationRepository({
      $transaction: async (fn: any) => fn(tx),
    } as never);
    return { tx, repo };
  }
  it('counts a reliable result even when automatic mastery writeback is disabled', async () => {
    const { tx, repo } = setup();
    expect(
      await repo.persistResult({
        subjectId: 'user-a',
        assessmentId: result.assessmentId,
        result,
        learningWriteStatus: 'NOT_ELIGIBLE',
      }),
    ).toBe(true);
    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-a' },
        data: { dayNumber: { increment: 1 } },
      }),
    );
  });
  it.each([0])(
    'does not count cancelled, expired or duplicate finalization',
    async (count) => {
      const { tx, repo } = setup(count);
      expect(
        await repo.persistResult({
          subjectId: 'user-a',
          assessmentId: result.assessmentId,
          result,
          learningWriteStatus: 'NOT_ELIGIBLE',
        }),
      ).toBe(false);
      expect(tx.$executeRaw).not.toHaveBeenCalled();
    },
  );
  it('does not count reference-only feedback', async () => {
    const { tx, repo } = setup();
    await repo.persistResult({
      subjectId: 'user-a',
      assessmentId: result.assessmentId,
      result: {
        ...result,
        confidenceTier: 'REFERENCE_ONLY',
        nextAction: 'retry',
      },
      learningWriteStatus: 'NOT_ELIGIBLE',
    });
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });
});
