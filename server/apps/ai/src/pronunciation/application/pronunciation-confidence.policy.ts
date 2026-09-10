import type {
  PronunciationConfidenceTier,
  PronunciationNextAction,
} from '@en/common/pronunciation';

export const PRONUNCIATION_CONFIDENCE_RELIABLE_THRESHOLD = 0.8;
export const PRONUNCIATION_CONFIDENCE_REFERENCE_THRESHOLD = 0.6;

export type PronunciationConfidenceInput = Readonly<{
  confidence: number;
  overallScore: number;
  providerOutcome: 'SUCCESS' | 'UNRECOGNIZABLE';
  schemaValid: boolean;
  alignmentReliable: boolean;
  sourceValid: boolean;
  audioValid: boolean;
  versionsPinned: boolean;
  cancelled: boolean;
  timedOut: boolean;
  learningWriteEnabled: boolean;
}>;

export type PronunciationConfidenceDecision = Readonly<{
  confidenceTier: PronunciationConfidenceTier;
  resultEligible: boolean;
  learningWriteEligible: boolean;
  nextAction: PronunciationNextAction;
  noWriteReasons: readonly string[];
}>;

export class PronunciationConfidencePolicy {
  decide(input: PronunciationConfidenceInput): PronunciationConfidenceDecision {
    if (
      !Number.isFinite(input.confidence) ||
      input.confidence < 0 ||
      input.confidence > 1 ||
      !Number.isFinite(input.overallScore) ||
      input.overallScore < 0 ||
      input.overallScore > 100
    ) {
      throw new Error('Pronunciation confidence input is out of range');
    }

    const hardRejection =
      input.providerOutcome !== 'SUCCESS' ||
      !input.schemaValid ||
      !input.sourceValid ||
      !input.audioValid ||
      input.cancelled ||
      input.timedOut ||
      input.confidence < PRONUNCIATION_CONFIDENCE_REFERENCE_THRESHOLD;
    const confidenceTier: PronunciationConfidenceTier = hardRejection
      ? 'REJECTED'
      : input.confidence < PRONUNCIATION_CONFIDENCE_RELIABLE_THRESHOLD ||
          !input.alignmentReliable
        ? 'REFERENCE_ONLY'
        : 'RELIABLE';
    const resultEligible = confidenceTier !== 'REJECTED';
    const noWriteReasons = [
      ...(input.providerOutcome !== 'SUCCESS' ? ['PROVIDER_OUTCOME'] : []),
      ...(!input.schemaValid ? ['SCHEMA_INVALID'] : []),
      ...(!input.alignmentReliable ? ['ALIGNMENT_UNRELIABLE'] : []),
      ...(!input.sourceValid ? ['SOURCE_INVALID'] : []),
      ...(!input.audioValid ? ['AUDIO_INVALID'] : []),
      ...(!input.versionsPinned ? ['VERSIONS_UNPINNED'] : []),
      ...(input.cancelled ? ['CANCELLED'] : []),
      ...(input.timedOut ? ['TIMED_OUT'] : []),
      ...(confidenceTier !== 'RELIABLE' ? ['CONFIDENCE_NOT_RELIABLE'] : []),
      ...(!input.learningWriteEnabled ? ['LEARNING_WRITE_DISABLED'] : []),
    ];
    const learningWriteEligible = noWriteReasons.length === 0;
    const nextAction: PronunciationNextAction =
      !resultEligible || confidenceTier === 'REFERENCE_ONLY'
        ? 'retry'
        : input.overallScore < 75
          ? 'review'
          : 'continue';

    return Object.freeze({
      confidenceTier,
      resultEligible,
      learningWriteEligible,
      nextAction,
      noWriteReasons: Object.freeze(noWriteReasons),
    });
  }
}
