import { PRONUNCIATION_LEARNING_MAPPING_VERSION } from '@en/common/pronunciation';
import { qualityFromScore } from '../grading/deterministic-grader';
import { aggregateLowestQuality } from '../review/sm2-review-scheduler';

export const PRONUNCIATION_QUALITY_POLICY_VERSION =
  PRONUNCIATION_LEARNING_MAPPING_VERSION;

export type PronunciationLearningWord = Readonly<{
  targetPosition: number | null;
  word: string;
  wordId: string | null;
  status: 'correct' | 'mispronounced' | 'omitted' | 'inserted' | 'uncertain';
  score: number | null;
  alignmentReliable: boolean;
}>;

export type PronunciationLearningEvidence = Readonly<{
  targetType: 'PRONUNCIATION_WORD';
  targetKey: string;
  wordId: string;
  targetPosition: number;
  word: string;
  quality: number;
  policyVersion: typeof PRONUNCIATION_QUALITY_POLICY_VERSION;
}>;

function quality(word: PronunciationLearningWord): number | null {
  if (
    !word.alignmentReliable ||
    !word.wordId ||
    word.targetPosition === null ||
    word.status === 'inserted' ||
    word.status === 'uncertain'
  ) {
    return null;
  }
  if (word.status === 'omitted') return 0;
  if (
    word.score === null ||
    !Number.isFinite(word.score) ||
    word.score < 0 ||
    word.score > 100
  ) {
    return null;
  }
  return qualityFromScore(word.score, 100);
}

export function pronunciationEvidenceFromWords(
  words: readonly PronunciationLearningWord[],
): readonly PronunciationLearningEvidence[] {
  const grouped = new Map<
    string,
    {
      wordId: string;
      targetPosition: number;
      word: string;
      qualities: number[];
    }
  >();
  for (const word of words) {
    const mapped = quality(word);
    if (mapped === null || !word.wordId || word.targetPosition === null)
      continue;
    const existing = grouped.get(word.wordId) ?? {
      wordId: word.wordId,
      targetPosition: word.targetPosition,
      word: word.word,
      qualities: [],
    };
    existing.targetPosition = Math.min(
      existing.targetPosition,
      word.targetPosition,
    );
    existing.qualities.push(mapped);
    grouped.set(word.wordId, existing);
  }
  return Object.freeze(
    [...grouped.values()]
      .sort(
        (left, right) =>
          left.targetPosition - right.targetPosition ||
          left.wordId.localeCompare(right.wordId),
      )
      .map((entry) =>
        Object.freeze({
          targetType: 'PRONUNCIATION_WORD' as const,
          targetKey: entry.wordId,
          wordId: entry.wordId,
          targetPosition: entry.targetPosition,
          word: entry.word,
          quality: aggregateLowestQuality(entry.qualities),
          policyVersion: PRONUNCIATION_QUALITY_POLICY_VERSION,
        }),
      ),
  );
}
