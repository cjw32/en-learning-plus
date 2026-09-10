import {
  PRONUNCIATION_QUALITY_POLICY_VERSION,
  pronunciationEvidenceFromWords,
} from './pronunciation-quality.policy';

const word = (overrides: Record<string, unknown> = {}) => ({
  targetPosition: 0,
  word: 'hello',
  wordId: 'word-1',
  status: 'correct',
  score: 90,
  alignmentReliable: true,
  ...overrides,
});

describe('pronunciation-quality.v1', () => {
  it.each([
    [90, 5],
    [75, 4],
    [60, 3],
    [40, 2],
    [1, 1],
    [0, 0],
  ])('reuses the existing score threshold %d -> %d', (score, quality) => {
    expect(pronunciationEvidenceFromWords([word({ score })])).toEqual([
      expect.objectContaining({ quality }),
    ]);
  });

  it('maps omitted words to zero and emits only PRONUNCIATION_WORD evidence', () => {
    expect(
      pronunciationEvidenceFromWords([
        word({ status: 'omitted', score: null }),
      ]),
    ).toEqual([
      expect.objectContaining({
        targetType: 'PRONUNCIATION_WORD',
        targetKey: 'word-1',
        quality: 0,
        policyVersion: PRONUNCIATION_QUALITY_POLICY_VERSION,
      }),
    ]);
  });

  it.each([
    { status: 'inserted', targetPosition: null },
    { status: 'uncertain' },
    { wordId: null },
    { alignmentReliable: false },
  ])('emits no evidence for unsafe word %j', (override) => {
    expect(pronunciationEvidenceFromWords([word(override)])).toEqual([]);
  });

  it('uses the lowest quality once for duplicate word/position evidence', () => {
    expect(
      pronunciationEvidenceFromWords([
        word({ score: 95 }),
        word({ score: 40 }),
        word({ targetPosition: 1, score: 75 }),
      ]),
    ).toEqual([
      expect.objectContaining({
        targetType: 'PRONUNCIATION_WORD',
        targetKey: 'word-1',
        quality: 2,
      }),
    ]);
  });
});
