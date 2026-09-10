import {
  normalizePronunciationTarget,
  PronunciationTargetValidationError,
} from './pronunciation-target-normalizer';

describe('normalizePronunciationTarget', () => {
  it.each(['', '   ', '...?!'])(
    'rejects empty/punctuation-only %p',
    (value) => {
      expect(() => normalizePronunciationTarget(value)).toThrow(
        PronunciationTargetValidationError,
      );
    },
  );

  it.each(['你好 world', 'hello\u0000world', 'hello\u200Bworld'])(
    'rejects non-English or dangerous input %p',
    (value) => {
      expect(() => normalizePronunciationTarget(value)).toThrow(
        PronunciationTargetValidationError,
      );
    },
  );

  it('normalizes Unicode punctuation, case and whitespace into stable tokens', () => {
    expect(normalizePronunciationTarget('  DON’T\tstop—now!  ')).toEqual({
      referenceText: "DON'T stop-now!",
      normalizedTokens: ["don't", 'stop-now'],
      exerciseType: 'SENTENCE',
      wordCount: 2,
      characterCount: 15,
      normalizationVersion: 'pronunciation-normalization.v1',
    });
  });

  it('derives word, phrase and sentence deterministically', () => {
    expect(normalizePronunciationTarget('Hello').exerciseType).toBe('WORD');
    expect(normalizePronunciationTarget('hello world').exerciseType).toBe(
      'PHRASE',
    );
    expect(normalizePronunciationTarget('Hello world!').exerciseType).toBe(
      'SENTENCE',
    );
  });

  it('accepts the 30-word boundary and rejects 31 words', () => {
    expect(
      normalizePronunciationTarget(
        Array.from({ length: 30 }, () => 'a').join(' '),
      ).wordCount,
    ).toBe(30);
    expect(() =>
      normalizePronunciationTarget(
        Array.from({ length: 31 }, () => 'a').join(' '),
      ),
    ).toThrow('TOO_MANY_WORDS');
  });

  it('accepts the 200-character boundary and rejects 201 characters', () => {
    const atBoundary = `${'a'.repeat(100)} ${'b'.repeat(99)}`;
    expect(normalizePronunciationTarget(atBoundary).characterCount).toBe(200);
    expect(() => normalizePronunciationTarget(`${atBoundary}c`)).toThrow(
      'TOO_MANY_CHARACTERS',
    );
  });
});
