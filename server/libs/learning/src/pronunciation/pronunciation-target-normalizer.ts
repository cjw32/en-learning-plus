import {
  PRONUNCIATION_NORMALIZATION_VERSION,
  type PronunciationExerciseType,
} from '@en/common/pronunciation';

// Common whitespace is normalized below; invisible formatting and all other
// control bytes are rejected before any target is persisted.
const formattingPattern = /\p{Cf}/u;
const tokenPattern = /[A-Za-z]+(?:['-][A-Za-z]+)*|\d+(?:[.,]\d+)*/gu;
const allowedPunctuationPattern = /^[\s.,!?;:'"()[\]{}\-–—…/\\&+%$#@]*$/u;

function hasForbiddenControl(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return (
      codePoint <= 0x08 ||
      codePoint === 0x0b ||
      codePoint === 0x0c ||
      (codePoint >= 0x0e && codePoint <= 0x1f) ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      formattingPattern.test(character)
    );
  });
}

export class PronunciationTargetValidationError extends Error {
  readonly code = 'VALIDATION_FAILED';

  constructor(readonly reason: string) {
    super(`Pronunciation target is invalid: ${reason}`);
    this.name = 'PronunciationTargetValidationError';
  }
}

export type NormalizedPronunciationTarget = Readonly<{
  referenceText: string;
  normalizedTokens: readonly string[];
  exerciseType: PronunciationExerciseType;
  wordCount: number;
  characterCount: number;
  normalizationVersion: typeof PRONUNCIATION_NORMALIZATION_VERSION;
}>;

export function normalizePronunciationToken(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[‘’‛]/gu, "'")
    .replace(/[‐‑‒–—―]/gu, '-')
    .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/gu, '')
    .toLocaleLowerCase('en-US');
}

export function normalizePronunciationTarget(
  untrusted: string,
): NormalizedPronunciationTarget {
  if (typeof untrusted !== 'string' || hasForbiddenControl(untrusted)) {
    throw new PronunciationTargetValidationError('CONTROL_OR_NON_TEXT');
  }
  const referenceText = untrusted
    .normalize('NFKC')
    .replace(/[‘’‛]/gu, "'")
    .replace(/[‐‑‒–—―]/gu, '-')
    .replace(/\s+/gu, ' ')
    .trim();
  const characterCount = Array.from(referenceText).length;
  if (characterCount === 0) {
    throw new PronunciationTargetValidationError('EMPTY');
  }
  if (characterCount > 200) {
    throw new PronunciationTargetValidationError('TOO_MANY_CHARACTERS');
  }

  const matches = [...referenceText.matchAll(tokenPattern)];
  const normalizedTokens = matches
    .map((match) => normalizePronunciationToken(match[0]))
    .filter(Boolean);
  if (normalizedTokens.length === 0) {
    throw new PronunciationTargetValidationError('PUNCTUATION_ONLY');
  }
  if (normalizedTokens.length > 30) {
    throw new PronunciationTargetValidationError('TOO_MANY_WORDS');
  }
  if (normalizedTokens.some((token) => Array.from(token).length > 100)) {
    throw new PronunciationTargetValidationError('WORD_TOO_LONG');
  }

  let remainder = referenceText;
  for (const match of [...matches].reverse()) {
    remainder = `${remainder.slice(0, match.index)}${remainder.slice(
      (match.index ?? 0) + match[0].length,
    )}`;
  }
  if (!allowedPunctuationPattern.test(remainder)) {
    throw new PronunciationTargetValidationError('NON_ENGLISH_OR_UNSAFE');
  }

  const exerciseType: PronunciationExerciseType =
    normalizedTokens.length === 1
      ? 'WORD'
      : /[.!?]["')\]}]*$/u.test(referenceText)
        ? 'SENTENCE'
        : 'PHRASE';
  return Object.freeze({
    referenceText,
    normalizedTokens: Object.freeze(normalizedTokens),
    exerciseType,
    wordCount: normalizedTokens.length,
    characterCount,
    normalizationVersion: PRONUNCIATION_NORMALIZATION_VERSION,
  });
}
