import { PronunciationAlignmentService } from '../../../src/pronunciation/application/pronunciation-alignment.service';

const word = (
  sequence: number,
  lexicalForm: string,
  offsetMs: number | null = sequence * 200,
  durationMs: number | null = offsetMs === null ? null : 150,
  errorType:
    | 'NONE'
    | 'MISPRONUNCIATION'
    | 'OMISSION'
    | 'INSERTION'
    | 'UNKNOWN' = 'NONE',
) => ({ sequence, lexicalForm, offsetMs, durationMs, score: 90, errorType });

describe('pronunciation deterministic alignment evaluation', () => {
  const aligner = new PronunciationAlignmentService();

  it.each([
    [
      ['Hello', 'world'],
      ['hello', 'WORLD'],
    ],
    [['don’t'], ["don't"]],
    [['42'], ['42']],
    [['twenty-one'], ['twenty‑one']],
    [['hello…'], ['hello']],
  ])(
    'normalizes Unicode/punctuation without losing target positions',
    (target, spoken) => {
      const result = aligner.align({
        targetTokens: target,
        providerWords: spoken.map((value, index) => word(index, value)),
        audioDurationMs: 3_000,
      });
      expect(result.words.map((item) => item.targetPosition)).toEqual(
        target.map((_, index) => index),
      );
      expect(result.words.every((item) => item.status === 'correct')).toBe(
        true,
      );
    },
  );

  it('keeps repeated occurrences stable while materializing omissions', () => {
    const result = aligner.align({
      targetTokens: ['the', 'cat', 'and', 'the', 'dog'],
      providerWords: ['the', 'cat', 'the', 'dog'].map((value, index) =>
        word(index, value),
      ),
      audioDurationMs: 3_000,
    });
    expect(
      result.words.map((item) => [item.word, item.targetPosition, item.status]),
    ).toEqual([
      ['the', 0, 'correct'],
      ['cat', 1, 'correct'],
      ['and', 2, 'omitted'],
      ['the', 3, 'correct'],
      ['dog', 4, 'correct'],
    ]);
    expect(result.words[2]).toMatchObject({
      startMs: null,
      endMs: null,
      score: null,
    });
  });

  it('does not let inserted words claim target positions', () => {
    const result = aligner.align({
      targetTokens: ['hello', 'world'],
      providerWords: [
        word(0, 'hello'),
        word(1, 'brave', 200, 150, 'INSERTION'),
        word(2, 'world'),
      ],
      audioDurationMs: 3_000,
    });
    expect(
      result.words.map((item) => [item.word, item.targetPosition, item.status]),
    ).toEqual([
      ['hello', 0, 'correct'],
      ['brave', null, 'inserted'],
      ['world', 1, 'correct'],
    ]);
  });

  it('falls back to explicit uncertainty for reordered ambiguous words', () => {
    const result = aligner.align({
      targetTokens: ['one', 'two', 'three'],
      providerWords: ['two', 'one', 'three'].map((value, index) =>
        word(index, value),
      ),
      audioDurationMs: 3_000,
    });
    expect(result.reliable).toBe(false);
    expect(result.words.some((item) => item.status === 'uncertain')).toBe(true);
  });

  it.each([
    [-1, 100],
    [100, 0],
    [2_900, 200],
  ])(
    'nulls illegal timestamp offset=%i duration=%i and disables seek',
    (offsetMs, durationMs) => {
      const result = aligner.align({
        targetTokens: ['hello'],
        providerWords: [word(0, 'hello', offsetMs, durationMs)],
        audioDurationMs: 3_000,
      });
      expect(result.words[0]).toMatchObject({
        startMs: null,
        endMs: null,
        seekable: false,
      });
    },
  );
});
