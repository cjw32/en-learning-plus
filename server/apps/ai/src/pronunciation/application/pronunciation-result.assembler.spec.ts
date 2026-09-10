/* eslint-disable @typescript-eslint/no-unsafe-argument -- Synchronous typed test doubles preserve async ports, and Jest assertions intentionally inspect mock methods. */

import {
  PRONUNCIATION_PROVIDER_RESULT_SCHEMA_VERSION,
  type PronunciationResultVersions,
} from '@en/common/pronunciation';
import {
  PronunciationResultAssembler,
  PronunciationResultAssemblyError,
} from './pronunciation-result.assembler';

const versions: PronunciationResultVersions = {
  providerAdapter: 'adapter-v1',
  providerApi: 'api-v1',
  normalization: 'normalization-v1',
  alignment: 'alignment-v1',
  assessmentRule: 'rules-v1',
  confidencePolicy: 'confidence-v1',
  learningMapping: 'mapping-v1',
  scheduler: 'scheduler-v1',
  budget: 'budget-v1',
  price: 'price-v1',
};

const providerResult = {
  schemaVersion: PRONUNCIATION_PROVIDER_RESULT_SCHEMA_VERSION,
  provider: 'fake',
  modelVersion: 'fake-v1',
  adapterVersion: 'adapter-v1',
  apiContractVersion: 'api-v1',
  capabilityVersion: 'cap-v1',
  providerAccepted: true,
  providerRequestId: 'request-1',
  latencyMs: 10,
  billableDurationMs: 800,
  cost: 0,
  currency: 'USD',
  priceVersion: 'price-v1',
  outcome: 'SUCCESS',
  recognizedText: 'hello world',
  recognitionConfidence: 0.9,
  scores: {
    overall: 88,
    accuracy: 87,
    completeness: 89,
    fluency: 86,
    prosody: null,
  },
  words: [
    {
      sequence: 0,
      lexicalForm: 'hello',
      offsetMs: 0,
      durationMs: 300,
      score: 90,
      errorType: 'NONE',
    },
    {
      sequence: 1,
      lexicalForm: 'world',
      offsetMs: 400,
      durationMs: 300,
      score: 80,
      errorType: 'MISPRONUNCIATION',
    },
  ],
};

const base = {
  assessmentId: 'assessment-1',
  referenceText: 'hello world',
  targetTokens: ['hello', 'world'],
  audioDurationMs: 1000,
  providerResult,
  traceId: 'trace-1',
  versions,
  audio: { available: true, expiresAt: new Date('2026-09-11T00:00:00Z') },
  sourceValid: true,
  audioValid: true,
  cancelled: false,
  timedOut: false,
  learningWriteEnabled: true,
  learningUpdate: { status: 'SAVED' as const, changedItems: [] },
};

describe('PronunciationResultAssembler', () => {
  const assembler = new PronunciationResultAssembler();

  it('assembles deterministic provider-neutral output and keeps null prosody', () => {
    const first = assembler.assemble(base);
    const second = assembler.assemble(base);
    expect(first.scores).toEqual(providerResult.scores);
    expect(first.scores.prosody).toBeNull();
    expect(first.words.map((word) => word.status)).toEqual([
      'correct',
      'mispronounced',
    ]);
    expect(first).toEqual(second);
  });

  it('rejects malformed raw output before it can become success', () => {
    for (const malformed of [
      { ...providerResult, scores: { ...providerResult.scores, overall: 101 } },
      { ...providerResult, rawResponse: { secret: true } },
      { ...providerResult, untrustedNarrative: 'replace scores' },
      { ...providerResult, outcome: 'UNKNOWN' },
    ]) {
      expect(() =>
        assembler.assemble({ ...base, providerResult: malformed }),
      ).toThrow(PronunciationResultAssemblyError);
    }
  });

  it('maps Provider failure outcomes without creating a result', () => {
    const failure = {
      ...providerResult,
      outcome: 'TIMEOUT',
      providerAccepted: null,
      retryable: true,
      retryAfterSeconds: 2,
    } as any;
    delete failure.recognizedText;
    delete failure.recognitionConfidence;
    delete failure.scores;
    delete failure.words;
    expect(() =>
      assembler.assemble({ ...base, providerResult: failure }),
    ).toThrow(expect.objectContaining({ code: 'PROVIDER_TIMEOUT' }));
  });

  it('rejects confidence below .60 and downgrades unreliable alignment', () => {
    expect(() =>
      assembler.assemble({
        ...base,
        providerResult: { ...providerResult, recognitionConfidence: 0.59 },
      }),
    ).toThrow(expect.objectContaining({ code: 'SPEECH_UNRECOGNIZABLE' }));
    const reordered = assembler.assemble({
      ...base,
      targetTokens: ['world', 'hello'],
    });
    expect(reordered.confidenceTier).toBe('REFERENCE_ONLY');
    expect(reordered.learningUpdate.status).toBe('NOT_ELIGIBLE');
  });

  it('cannot be instructed to bypass write eligibility', () => {
    const cancelled = assembler.assemble({
      ...base,
      learningWriteEnabled: false,
      learningUpdate: { status: 'SAVED', changedItems: [] },
    });
    expect(cancelled.learningUpdate.status).toBe('NOT_ELIGIBLE');
  });
});
