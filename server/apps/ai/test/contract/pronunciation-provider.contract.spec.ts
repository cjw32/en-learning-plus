import {
  PRONUNCIATION_PROVIDER_RESULT_SCHEMA_VERSION,
  pronunciationProviderResultSchema,
} from '@en/common/pronunciation';

const success = {
  schemaVersion: PRONUNCIATION_PROVIDER_RESULT_SCHEMA_VERSION,
  provider: 'fake',
  modelVersion: 'model-v1',
  adapterVersion: 'adapter-v1',
  apiContractVersion: 'api-v1',
  capabilityVersion: 'capability-v1',
  providerAccepted: true,
  providerRequestId: 'provider-request-1',
  latencyMs: 100,
  billableDurationMs: 900,
  cost: 0.0001,
  currency: 'USD',
  priceVersion: 'price-v1',
  outcome: 'SUCCESS',
  recognizedText: 'hello',
  recognitionConfidence: 0.9,
  scores: {
    overall: 90,
    accuracy: 90,
    completeness: 90,
    fluency: 90,
    prosody: null,
  },
  words: [
    {
      sequence: 0,
      lexicalForm: 'hello',
      offsetMs: 100,
      durationMs: 300,
      score: 90,
      errorType: 'NONE',
    },
  ],
};

describe('pronunciation Provider boundary', () => {
  it('accepts only the complete provider-neutral success shape', () => {
    expect(pronunciationProviderResultSchema.parse(success)).toEqual(success);
    for (const dimension of [
      'overall',
      'accuracy',
      'completeness',
      'fluency',
      'prosody',
    ]) {
      const scores = { ...success.scores } as Record<string, unknown>;
      delete scores[dimension];
      expect(
        pronunciationProviderResultSchema.safeParse({ ...success, scores })
          .success,
      ).toBe(false);
    }
  });

  it.each([
    ['outcome', 'PARTIAL_SUCCESS'],
    ['words.0.errorType', 'SUBSTITUTION'],
    ['schemaVersion', 'provider-raw-vendor-v9'],
  ])('rejects unknown %s status/value', (path, value) => {
    const candidate = structuredClone(success) as any;
    const segments = path.split('.');
    let target = candidate;
    for (const segment of segments.slice(0, -1)) target = target[segment];
    target[segments.at(-1)!] = value;
    expect(pronunciationProviderResultSchema.safeParse(candidate).success).toBe(
      false,
    );
  });

  it.each([
    ['scores.overall', -0.01],
    ['scores.accuracy', 100.01],
    ['recognitionConfidence', 1.01],
    ['latencyMs', 30_001],
    ['words.0.offsetMs', -1],
  ])('rejects out-of-range %s', (path, value) => {
    const candidate = structuredClone(success) as any;
    const segments = path.split('.');
    let target = candidate;
    for (const segment of segments.slice(0, -1)) target = target[segment];
    target[segments.at(-1)!] = value;
    expect(pronunciationProviderResultSchema.safeParse(candidate).success).toBe(
      false,
    );
  });

  it.each([
    ['rawResponse', { vendor: 'private' }],
    ['endpoint', 'https://provider.internal'],
    ['apiKey', 'secret'],
    ['audioBytes', [1, 2, 3]],
    ['stack', 'internal stack'],
  ])('rejects leaked raw field %s', (field, value) => {
    expect(
      pronunciationProviderResultSchema.safeParse({
        ...success,
        [field]: value,
      }).success,
    ).toBe(false);
  });

  it('requires safe timestamp pairs and bounds', () => {
    expect(
      pronunciationProviderResultSchema.safeParse({
        ...success,
        words: [{ ...success.words[0], durationMs: null }],
      }).success,
    ).toBe(false);
    expect(
      pronunciationProviderResultSchema.safeParse({
        ...success,
        words: [{ ...success.words[0], offsetMs: 29_900, durationMs: 200 }],
      }).success,
    ).toBe(false);
  });
});
