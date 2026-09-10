import {
  PRONUNCIATION_LEARNING_MAPPING_VERSION,
  PRONUNCIATION_RESULT_SCHEMA_VERSION,
  PRONUNCIATION_SCHEDULER_VERSION,
} from '@en/common/pronunciation';

export type PronunciationLearningIneligibilityReason =
  | 'OWNER_MISMATCH'
  | 'ASSESSMENT_NOT_COMPLETED'
  | 'CONFIDENCE_LOW'
  | 'SCHEMA_INVALID'
  | 'AUDIO_INVALID'
  | 'SOURCE_INVALID'
  | 'CANCELLED'
  | 'TIMED_OUT'
  | 'NO_EVIDENCE'
  | 'VERSION_MISMATCH';

export type PronunciationLearningEligibilityInput = Readonly<{
  subjectId: string;
  assessmentSubjectId: string;
  assessmentStatus: string;
  confidence: number | null;
  confidenceTier: string | null;
  resultSchemaValid: boolean;
  audioValid: boolean;
  sourceValid: boolean;
  cancelled: boolean;
  timedOut: boolean;
  evidenceCount: number;
  versions: Readonly<{
    resultSchema: string | null;
    learningMapping: string | null;
    scheduler: string | null;
  }>;
}>;

export type PronunciationLearningEligibilityDecision = Readonly<{
  eligible: boolean;
  reasons: readonly PronunciationLearningIneligibilityReason[];
}>;

export class PronunciationLearningEligibility {
  evaluate(
    input: PronunciationLearningEligibilityInput,
  ): PronunciationLearningEligibilityDecision {
    const reasons: PronunciationLearningIneligibilityReason[] = [];
    if (input.subjectId !== input.assessmentSubjectId) {
      reasons.push('OWNER_MISMATCH');
    }
    if (input.assessmentStatus !== 'COMPLETED') {
      reasons.push('ASSESSMENT_NOT_COMPLETED');
    }
    if (
      input.confidence === null ||
      input.confidence < 0.8 ||
      input.confidenceTier !== 'RELIABLE'
    ) {
      reasons.push('CONFIDENCE_LOW');
    }
    if (!input.resultSchemaValid) reasons.push('SCHEMA_INVALID');
    if (!input.audioValid) reasons.push('AUDIO_INVALID');
    if (!input.sourceValid) reasons.push('SOURCE_INVALID');
    if (input.cancelled) reasons.push('CANCELLED');
    if (input.timedOut) reasons.push('TIMED_OUT');
    if (!Number.isSafeInteger(input.evidenceCount) || input.evidenceCount < 1) {
      reasons.push('NO_EVIDENCE');
    }
    if (
      input.versions.resultSchema !== PRONUNCIATION_RESULT_SCHEMA_VERSION ||
      input.versions.learningMapping !==
        PRONUNCIATION_LEARNING_MAPPING_VERSION ||
      input.versions.scheduler !== PRONUNCIATION_SCHEDULER_VERSION
    ) {
      reasons.push('VERSION_MISMATCH');
    }
    return Object.freeze({
      eligible: reasons.length === 0,
      reasons: Object.freeze(reasons),
    });
  }
}
