import {
  PronunciationContextService,
  type PronunciationContextRecord,
} from './pronunciation-context.service';

const record = (
  overrides: Partial<PronunciationContextRecord> = {},
): PronunciationContextRecord => ({
  assessmentId: 'assessment_00001',
  subjectId: 'user-a',
  assessmentStatus: 'COMPLETED',
  hiddenAt: null,
  deletedAt: null,
  confidenceTier: 'RELIABLE',
  scores: {
    overall: 72,
    accuracy: 68,
    completeness: 80,
    fluency: 75,
    prosody: null,
  },
  words: [
    {
      targetPosition: 0,
      word: 'hello',
      status: 'correct',
      score: 96,
      alignmentReliable: true,
      wordId: 'word-hello',
    },
    {
      targetPosition: 1,
      word: 'world',
      status: 'mispronounced',
      score: 52,
      alignmentReliable: true,
      wordId: 'word-world',
    },
    {
      targetPosition: null,
      word: 'extra',
      status: 'inserted',
      score: 70,
      alignmentReliable: true,
      wordId: null,
    },
  ],
  reviewChanges: [
    {
      targetPosition: 1,
      word: 'world',
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
  source: {
    sourceType: 'WORD_BOOK',
    courseId: null,
    wordId: 'word-world',
    knowledgeCitationId: null,
    sourceVersion: null,
    sourceContentHash: null,
    sourceRightsVersion: null,
  },
  ...overrides,
});

describe('PronunciationContextService', () => {
  it('projects only reliable scores, weak words, review changes and versions', async () => {
    const repository = { findOwned: jest.fn(async () => record()) };
    const service = new PronunciationContextService(repository);

    const result = await service.getOwnedSummary('user-a', 'assessment_00001');

    expect(repository.findOwned).toHaveBeenCalledWith(
      'user-a',
      'assessment_00001',
    );
    expect(result).toMatchObject({
      assessmentId: 'assessment_00001',
      confidenceTier: 'RELIABLE',
      weakWords: [
        {
          targetPosition: 1,
          word: 'world',
          status: 'mispronounced',
          score: 52,
        },
      ],
      reviewChanges: [
        {
          targetPosition: 1,
          word: 'world',
          nextReviewState: 'LEARNING',
          nextReviewAt: '2026-09-11T00:00:00.000Z',
        },
      ],
      nextAction: 'review',
    });
    expect(Object.keys(result ?? {}).sort()).toEqual(
      [
        'assessmentId',
        'assessmentStatus',
        'confidenceTier',
        'learningWriteStatus',
        'nextAction',
        'recommendationReason',
        'reviewChanges',
        'scores',
        'sourceStatus',
        'versions',
        'weakWords',
      ].sort(),
    );
  });

  it.each([
    ['different owner', { subjectId: 'user-b' }],
    ['hidden row', { hiddenAt: new Date('2026-09-10T00:00:00.000Z') }],
    ['deleted row', { deletedAt: new Date('2026-09-10T00:00:00.000Z') }],
  ])('does not expose a %s', async (_label, overrides) => {
    const service = new PronunciationContextService({
      findOwned: jest.fn(async () => record(overrides as never)),
    });

    await expect(
      service.getOwnedSummary('user-a', 'assessment_00001'),
    ).resolves.toBeNull();
  });

  it('does not expose weak/review facts as confirmed when confidence is low', async () => {
    const service = new PronunciationContextService({
      findOwned: jest.fn(async () =>
        record({
          assessmentStatus: 'REFERENCE_ONLY',
          confidenceTier: 'REFERENCE_ONLY',
        }),
      ),
    });

    const result = await service.getOwnedSummary('user-a', 'assessment_00001');

    expect(result).toMatchObject({
      weakWords: [],
      reviewChanges: [],
      nextAction: 'retry',
      learningWriteStatus: 'NOT_ELIGIBLE',
    });
  });
});
