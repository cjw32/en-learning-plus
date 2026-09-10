import { expect, test } from '@playwright/test';
import {
  PRONUNCIATION_PROVIDER_RESULT_SCHEMA_VERSION,
  type PronunciationProviderAssessmentInput,
  type PronunciationProviderResult,
  type PronunciationProviderWord,
} from '@en/common/pronunciation';
import { normalizePronunciationTarget } from '../server/libs/learning/src/pronunciation/pronunciation-target-normalizer';
import { PronunciationResultAssembler } from '../server/apps/ai/src/pronunciation/application/pronunciation-result.assembler';
import { FakePronunciationAssessmentProvider } from '../server/apps/ai/src/pronunciation/provider/pronunciation-assessment.provider';

const cases = [
  {
    label: 'word',
    referenceText: 'Hello',
    exerciseType: 'WORD',
    words: [
      {
        sequence: 0,
        lexicalForm: 'hello',
        offsetMs: 0,
        durationMs: 300,
        score: 98,
        errorType: 'NONE',
      },
    ],
  },
  {
    label: 'phrase',
    referenceText: 'Hello brave',
    exerciseType: 'PHRASE',
    words: [
      {
        sequence: 0,
        lexicalForm: 'hello',
        offsetMs: 0,
        durationMs: 250,
        score: 95,
        errorType: 'NONE',
      },
      {
        sequence: 1,
        lexicalForm: 'extra',
        offsetMs: 260,
        durationMs: 150,
        score: 65,
        errorType: 'INSERTION',
      },
      {
        sequence: 2,
        lexicalForm: 'brave',
        offsetMs: 420,
        durationMs: 300,
        score: 62,
        errorType: 'MISPRONUNCIATION',
      },
    ],
  },
  {
    label: 'sentence',
    referenceText: 'Hello quiet world.',
    exerciseType: 'SENTENCE',
    words: [
      {
        sequence: 0,
        lexicalForm: 'hello',
        offsetMs: 0,
        durationMs: 250,
        score: 93,
        errorType: 'NONE',
      },
      {
        sequence: 1,
        lexicalForm: 'quiet',
        offsetMs: null,
        durationMs: null,
        score: null,
        errorType: 'OMISSION',
      },
      {
        sequence: 2,
        lexicalForm: 'world',
        offsetMs: 520,
        durationMs: 330,
        score: 75,
        errorType: 'UNKNOWN',
      },
    ],
  },
] as const satisfies readonly {
  label: string;
  referenceText: string;
  exerciseType: 'WORD' | 'PHRASE' | 'SENTENCE';
  words: readonly PronunciationProviderWord[];
}[];

function providerResult(
  input: PronunciationProviderAssessmentInput,
  words: readonly PronunciationProviderWord[],
): PronunciationProviderResult {
  return {
    schemaVersion: PRONUNCIATION_PROVIDER_RESULT_SCHEMA_VERSION,
    provider: 'fake',
    modelVersion: 'fake-model.v1',
    adapterVersion: 'fake-adapter.v1',
    apiContractVersion: 'fake-api.v1',
    capabilityVersion: 'fake-capability.v1',
    providerAccepted: true,
    providerRequestId: `fake-${input.assessmentId}`,
    latencyMs: 1,
    billableDurationMs: 1_000,
    cost: 0,
    currency: 'USD',
    priceVersion: 'fake-price.v1',
    outcome: 'SUCCESS',
    recognizedText: words
      .filter((word) => word.errorType !== 'OMISSION')
      .map((word) => word.lexicalForm)
      .join(' '),
    recognitionConfidence: 0.9,
    scores: {
      overall: 84,
      accuracy: 82,
      completeness: 80,
      fluency: 86,
      prosody: null,
    },
    words: [...words],
  };
}

test('fake Provider completes word, phrase and sentence journeys with every word state', async () => {
  const statuses = new Set<string>();
  for (const fixture of cases) {
    const target = normalizePronunciationTarget(fixture.referenceText);
    expect(target.exerciseType).toBe(fixture.exerciseType);
    const provider = new FakePronunciationAssessmentProvider((input) =>
      providerResult(input, fixture.words),
    );
    const assessmentId = `assessment-${fixture.label}`;
    const raw = await provider.assess({
      assessmentId,
      referenceText: target.referenceText,
      locale: 'en-US',
      canonicalAudio: Uint8Array.from([1, 2, 3]),
      applicationConnectionId: `connection-${fixture.label}`,
      deadlineAt: new Date(Date.now() + 30_000),
    });
    const result = new PronunciationResultAssembler().assemble({
      assessmentId,
      referenceText: target.referenceText,
      targetTokens: target.normalizedTokens,
      audioDurationMs: 1_000,
      providerResult: raw,
      traceId: `trace-${fixture.label}`,
      versions: {
        providerAdapter: 'fake-adapter.v1',
        providerApi: 'fake-api.v1',
        normalization: target.normalizationVersion,
        alignment: 'pronunciation-alignment.v1',
        assessmentRule: 'pronunciation-assessment.v1',
        confidencePolicy: 'pronunciation-confidence.v1',
        learningMapping: 'pronunciation-quality.v1',
        scheduler: 'sm2.v1',
        budget: 'fake-budget.v1',
        price: 'fake-price.v1',
      },
      audio: { available: true, expiresAt: null },
      sourceValid: true,
      audioValid: true,
      cancelled: false,
      timedOut: false,
      learningWriteEnabled: false,
    });
    expect(result.assessmentId).toBe(assessmentId);
    expect(result.learningUpdate.status).toBe('NOT_ELIGIBLE');
    expect(provider.callCount).toBe(1);
    result.words.forEach((word) => statuses.add(word.status));
  }

  expect(statuses).toEqual(
    new Set(['correct', 'mispronounced', 'omitted', 'inserted', 'uncertain']),
  );
});
