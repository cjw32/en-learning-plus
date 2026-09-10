import {
  PronunciationContextService,
  type PronunciationContextRecord,
} from './pronunciation-context.service';

const source = {
  sourceType: 'RAG_CITATION' as const,
  courseId: null,
  wordId: null,
  knowledgeCitationId: 'citation_00001',
  sourceVersion: 'content-v4',
  sourceContentHash: 'a'.repeat(64),
  sourceRightsVersion: 'rights-v2',
};

const row: PronunciationContextRecord = {
  assessmentId: 'assessment_00001',
  subjectId: 'user-a',
  assessmentStatus: 'COMPLETED',
  hiddenAt: null,
  deletedAt: null,
  confidenceTier: 'RELIABLE',
  scores: {
    overall: 65,
    accuracy: 60,
    completeness: 75,
    fluency: 68,
    prosody: null,
  },
  words: [
    {
      targetPosition: 0,
      word: 'context',
      status: 'mispronounced',
      score: 45,
      alignmentReliable: true,
      wordId: 'word-context',
    },
  ],
  reviewChanges: [
    {
      targetPosition: 0,
      word: 'context',
      nextReviewState: 'LEARNING',
      nextReviewAt: new Date('2026-09-11T00:00:00.000Z'),
    },
  ],
  learningWriteStatus: 'SAVED',
  versions: {
    resultSchema: 'pronunciation-result.v1',
    assessmentRule: 'pronunciation-assessment.v1',
    confidencePolicy: 'pronunciation-confidence.v1',
    learningMapping: 'pronunciation-quality.v1',
    scheduler: 'SM2_V1',
  },
  source,
};

describe('PronunciationContextService RAG lifecycle', () => {
  it('revalidates the exact owner, citation and captured versions', async () => {
    const rights = { revalidate: jest.fn(async () => undefined) };
    const service = new PronunciationContextService(
      { findOwned: jest.fn(async () => row) },
      rights,
    );

    const result = await service.getOwnedSummary('user-a', row.assessmentId);

    expect(rights.revalidate).toHaveBeenCalledWith({
      subjectId: 'user-a',
      sourceType: 'RAG_CITATION',
      courseId: null,
      wordId: null,
      knowledgeCitationId: 'citation_00001',
      expected: {
        sourceVersion: 'content-v4',
        sourceContentHash: 'a'.repeat(64),
        sourceRightsVersion: 'rights-v2',
      },
    });
    expect(result).toMatchObject({
      sourceStatus: 'ACTIVE',
      nextAction: 'review',
    });
  });

  it.each(['citation revoked', 'content version changed', 'access removed'])(
    'degrades safely when %s',
    async () => {
      const service = new PronunciationContextService(
        { findOwned: jest.fn(async () => row) },
        { revalidate: jest.fn(async () => Promise.reject(new Error('gone'))) },
      );

      const result = await service.getOwnedSummary('user-a', row.assessmentId);

      expect(result).toMatchObject({
        sourceStatus: 'UNAVAILABLE',
        weakWords: [],
        reviewChanges: [],
        nextAction: 'retry',
      });
    },
  );
});
