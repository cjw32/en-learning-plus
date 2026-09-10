import type {
  PronunciationProviderWord,
  PronunciationWordAssessment,
} from '@en/common/pronunciation';
import { normalizePronunciationToken } from '@libs/learning/pronunciation/pronunciation-target-normalizer';

export type AlignedPronunciationWord = PronunciationWordAssessment &
  Readonly<{ seekable: boolean }>;

export type PronunciationAlignmentResult = Readonly<{
  reliable: boolean;
  words: readonly AlignedPronunciationWord[];
}>;

type Pair = Readonly<{ target: number; provider: number }>;

function lcsPairs(
  target: readonly string[],
  provider: readonly string[],
): Pair[] {
  const rows = target.length + 1;
  const columns = provider.length + 1;
  const lengths = Array.from({ length: rows }, () =>
    Array<number>(columns).fill(0),
  );
  for (
    let targetIndex = target.length - 1;
    targetIndex >= 0;
    targetIndex -= 1
  ) {
    for (
      let providerIndex = provider.length - 1;
      providerIndex >= 0;
      providerIndex -= 1
    ) {
      lengths[targetIndex][providerIndex] =
        target[targetIndex] === provider[providerIndex]
          ? lengths[targetIndex + 1][providerIndex + 1] + 1
          : Math.max(
              lengths[targetIndex + 1][providerIndex],
              lengths[targetIndex][providerIndex + 1],
            );
    }
  }
  const pairs: Pair[] = [];
  let targetIndex = 0;
  let providerIndex = 0;
  while (targetIndex < target.length && providerIndex < provider.length) {
    if (target[targetIndex] === provider[providerIndex]) {
      pairs.push({ target: targetIndex, provider: providerIndex });
      targetIndex += 1;
      providerIndex += 1;
    } else if (
      lengths[targetIndex + 1][providerIndex] >=
      lengths[targetIndex][providerIndex + 1]
    ) {
      targetIndex += 1;
    } else {
      providerIndex += 1;
    }
  }
  return pairs;
}

function statusFor(word: PronunciationProviderWord) {
  switch (word.errorType) {
    case 'NONE':
      return 'correct' as const;
    case 'MISPRONUNCIATION':
      return 'mispronounced' as const;
    case 'OMISSION':
      return 'omitted' as const;
    case 'INSERTION':
      return 'inserted' as const;
    default:
      return 'uncertain' as const;
  }
}

function feedbackFor(
  status: AlignedPronunciationWord['status'],
): string | null {
  return {
    correct: null,
    mispronounced: '这个词的发音需要再练习。',
    omitted: '这个词没有检测到清晰发音。',
    inserted: '检测到目标文本之外的词。',
    uncertain: '这个词的对齐结果仅供参考。',
  }[status];
}

export class PronunciationAlignmentService {
  align(
    input: Readonly<{
      targetTokens: readonly string[];
      providerWords: readonly PronunciationProviderWord[];
      audioDurationMs: number;
    }>,
  ): PronunciationAlignmentResult {
    if (
      input.targetTokens.length < 1 ||
      input.targetTokens.length > 30 ||
      input.providerWords.length > 90 ||
      !Number.isSafeInteger(input.audioDurationMs) ||
      input.audioDurationMs < 1
    ) {
      throw new Error('Pronunciation alignment input is invalid');
    }
    const target = input.targetTokens.map(normalizePronunciationToken);
    const provider = input.providerWords.map((item) =>
      normalizePronunciationToken(item.lexicalForm),
    );
    const eligibleProviderIndexes = input.providerWords.flatMap(
      (item, index) => (item.errorType === 'INSERTION' ? [] : [index]),
    );
    const eligibleProvider = eligibleProviderIndexes.map(
      (index) => provider[index],
    );

    if (
      target.length === eligibleProvider.length &&
      target.every((token) => eligibleProvider.includes(token)) &&
      target.some((token, index) => token !== eligibleProvider[index])
    ) {
      return this.reorderedFallback(input, target, provider);
    }

    const eligiblePairs = lcsPairs(target, eligibleProvider);
    const pairs = eligiblePairs.map((pair) => ({
      target: pair.target,
      provider: eligibleProviderIndexes[pair.provider],
    }));
    const words: AlignedPronunciationWord[] = [];
    let previousTarget = -1;
    let previousProvider = -1;
    let reliable = true;

    for (const pair of [
      ...pairs,
      { target: target.length, provider: provider.length },
    ]) {
      const targetGap = Array.from(
        { length: pair.target - previousTarget - 1 },
        (_, offset) => previousTarget + offset + 1,
      );
      const providerGap = Array.from(
        { length: pair.provider - previousProvider - 1 },
        (_, offset) => previousProvider + offset + 1,
      );
      const substitutions = Math.min(targetGap.length, providerGap.length);
      for (let index = 0; index < substitutions; index += 1) {
        words.push(
          this.providerWord(
            input,
            input.providerWords[providerGap[index]],
            targetGap[index],
            input.targetTokens[targetGap[index]],
            'uncertain',
          ),
        );
        reliable = false;
      }
      for (const targetIndex of targetGap.slice(substitutions)) {
        words.push(this.omission(input.targetTokens[targetIndex], targetIndex));
      }
      for (const providerIndex of providerGap.slice(substitutions)) {
        const providerWord = input.providerWords[providerIndex];
        words.push(
          this.providerWord(
            input,
            providerWord,
            null,
            providerWord.lexicalForm,
            providerWord.errorType === 'UNKNOWN' ? 'uncertain' : 'inserted',
          ),
        );
        if (providerWord.errorType !== 'INSERTION') reliable = false;
      }
      if (pair.target < target.length && pair.provider < provider.length) {
        const providerWord = input.providerWords[pair.provider];
        const status = statusFor(providerWord);
        words.push(
          status === 'omitted'
            ? this.omission(input.targetTokens[pair.target], pair.target)
            : this.providerWord(
                input,
                providerWord,
                pair.target,
                input.targetTokens[pair.target],
                status,
              ),
        );
        if (status === 'uncertain') reliable = false;
      }
      previousTarget = pair.target;
      previousProvider = pair.provider;
    }

    const sanitized = this.sanitizeSequence(words, input.audioDurationMs);
    if (
      sanitized.some((word, index) => word.seekable !== words[index].seekable)
    ) {
      reliable = false;
    }
    return Object.freeze({
      reliable,
      words: Object.freeze(
        sanitized.map((word, sequence) => Object.freeze({ ...word, sequence })),
      ),
    });
  }

  private reorderedFallback(
    input: Readonly<{
      targetTokens: readonly string[];
      providerWords: readonly PronunciationProviderWord[];
      audioDurationMs: number;
    }>,
    target: readonly string[],
    provider: readonly string[],
  ): PronunciationAlignmentResult {
    const unused = new Set(target.map((_, index) => index));
    const words = input.providerWords.map((providerWord, providerIndex) => {
      const targetPosition = [...unused].find(
        (index) => target[index] === provider[providerIndex],
      );
      if (targetPosition !== undefined) unused.delete(targetPosition);
      return this.providerWord(
        input,
        providerWord,
        targetPosition ?? null,
        targetPosition === undefined
          ? providerWord.lexicalForm
          : input.targetTokens[targetPosition],
        targetPosition === undefined ? 'inserted' : 'uncertain',
      );
    });
    return Object.freeze({
      reliable: false,
      words: Object.freeze(
        this.sanitizeSequence(words, input.audioDurationMs).map(
          (word, sequence) => Object.freeze({ ...word, sequence }),
        ),
      ),
    });
  }

  private omission(
    word: string,
    targetPosition: number,
  ): AlignedPronunciationWord {
    return Object.freeze({
      sequence: 0,
      targetPosition,
      word,
      normalizedWord: normalizePronunciationToken(word),
      startMs: null,
      endMs: null,
      score: null,
      status: 'omitted',
      feedback: feedbackFor('omitted'),
      seekable: false,
    });
  }

  private providerWord(
    input: Readonly<{ audioDurationMs: number }>,
    providerWord: PronunciationProviderWord,
    targetPosition: number | null,
    displayWord: string,
    status: AlignedPronunciationWord['status'],
  ): AlignedPronunciationWord {
    const timestamp = this.timestamp(providerWord, input.audioDurationMs);
    const omitted = status === 'omitted';
    return Object.freeze({
      sequence: 0,
      targetPosition,
      word: displayWord,
      normalizedWord: normalizePronunciationToken(displayWord),
      startMs: omitted ? null : timestamp.startMs,
      endMs: omitted ? null : timestamp.endMs,
      score: omitted ? null : providerWord.score,
      status,
      feedback: feedbackFor(status),
      seekable: !omitted && timestamp.startMs !== null,
    });
  }

  private timestamp(
    word: PronunciationProviderWord,
    audioDurationMs: number,
  ): { startMs: number | null; endMs: number | null } {
    if (
      !Number.isSafeInteger(word.offsetMs) ||
      !Number.isSafeInteger(word.durationMs) ||
      word.offsetMs === null ||
      word.durationMs === null ||
      word.offsetMs < 0 ||
      word.durationMs <= 0 ||
      word.offsetMs + word.durationMs > audioDurationMs
    ) {
      return { startMs: null, endMs: null };
    }
    return { startMs: word.offsetMs, endMs: word.offsetMs + word.durationMs };
  }

  private sanitizeSequence(
    words: readonly AlignedPronunciationWord[],
    audioDurationMs: number,
  ): AlignedPronunciationWord[] {
    let previousEnd = 0;
    return words.map((word) => {
      if (
        word.startMs === null ||
        word.endMs === null ||
        word.startMs < previousEnd ||
        word.endMs > audioDurationMs
      ) {
        return Object.freeze({
          ...word,
          startMs: null,
          endMs: null,
          seekable: false,
        });
      }
      previousEnd = word.endMs;
      return word;
    });
  }
}
