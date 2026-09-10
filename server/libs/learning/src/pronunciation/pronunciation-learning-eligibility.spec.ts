import {
  PronunciationLearningEligibility,
  type PronunciationLearningEligibilityInput,
} from './pronunciation-learning-eligibility';

const valid: PronunciationLearningEligibilityInput = {
  subjectId: 'user-a',
  assessmentSubjectId: 'user-a',
  assessmentStatus: 'COMPLETED',
  confidence: 0.8,
  confidenceTier: 'RELIABLE',
  resultSchemaValid: true,
  audioValid: true,
  sourceValid: true,
  cancelled: false,
  timedOut: false,
  evidenceCount: 1,
  versions: {
    resultSchema: 'pronunciation-result.v1',
    learningMapping: 'pronunciation-quality.v1',
    scheduler: 'SM2_V1',
  },
};

describe('PronunciationLearningEligibility', () => {
  const policy = new PronunciationLearningEligibility();

  it('keeps .79 out and admits the exact .80 confidence boundary', () => {
    expect(policy.evaluate({ ...valid, confidence: 0.79 })).toMatchObject({
      eligible: false,
      reasons: ['CONFIDENCE_LOW'],
    });
    expect(policy.evaluate(valid)).toEqual({ eligible: true, reasons: [] });
  });

  it.each([
    ['OWNER_MISMATCH', { assessmentSubjectId: 'user-b' }],
    ['ASSESSMENT_NOT_COMPLETED', { assessmentStatus: 'REFERENCE_ONLY' }],
    ['CONFIDENCE_LOW', { confidenceTier: 'REFERENCE_ONLY' }],
    ['SCHEMA_INVALID', { resultSchemaValid: false }],
    ['AUDIO_INVALID', { audioValid: false }],
    ['SOURCE_INVALID', { sourceValid: false }],
    ['CANCELLED', { cancelled: true }],
    ['TIMED_OUT', { timedOut: true }],
    ['NO_EVIDENCE', { evidenceCount: 0 }],
    [
      'VERSION_MISMATCH',
      {
        versions: {
          ...valid.versions,
          learningMapping: 'pronunciation-quality.future',
        },
      },
    ],
  ])('rejects %s independently without a write', (reason, override) => {
    expect(policy.evaluate({ ...valid, ...override })).toMatchObject({
      eligible: false,
      reasons: [reason],
    });
  });
});
