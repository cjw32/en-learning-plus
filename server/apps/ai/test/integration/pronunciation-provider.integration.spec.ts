import {
  PRONUNCIATION_PROVIDER_RESULT_SCHEMA_VERSION,
  type PronunciationProviderAssessmentInput,
  type PronunciationProviderFailure,
  type PronunciationProviderResult,
} from '@en/common/pronunciation';
import type { PronunciationAssessmentProvider } from '../../src/pronunciation/provider/pronunciation-assessment.provider';
import {
  PronunciationProviderExecutor,
  type PronunciationProviderAttemptLedger,
} from '../../src/pronunciation/provider/pronunciation-provider.executor';

const input: PronunciationProviderAssessmentInput = {
  assessmentId: 'assessment-provider-1',
  referenceText: 'hello world',
  locale: 'en-US',
  canonicalAudio: Uint8Array.from([1, 2, 3]),
  applicationConnectionId: 'initial-connection',
  deadlineAt: new Date('2026-09-10T00:00:30.000Z'),
};

const base = {
  schemaVersion: PRONUNCIATION_PROVIDER_RESULT_SCHEMA_VERSION,
  provider: 'fake',
  modelVersion: 'fake-model-v1',
  adapterVersion: 'fake-adapter-v1',
  apiContractVersion: 'fake-api-v1',
  capabilityVersion: 'fake-capability-v1',
  providerRequestId: null,
  latencyMs: 10,
  billableDurationMs: 1_000,
  cost: 0.00001,
  currency: 'USD',
  priceVersion: 'price-v1',
} as const;

function failure(
  outcome: PronunciationProviderFailure['outcome'],
  providerAccepted: boolean | null,
  retryable: boolean,
): PronunciationProviderFailure {
  return {
    ...base,
    outcome,
    providerAccepted,
    retryable,
    retryAfterSeconds: outcome === 'RATE_LIMITED' ? 7 : null,
  };
}

const success: PronunciationProviderResult = {
  ...base,
  outcome: 'SUCCESS',
  providerAccepted: true,
  recognizedText: 'hello world',
  recognitionConfidence: 0.99,
  scores: {
    overall: 95,
    accuracy: 95,
    completeness: 100,
    fluency: 90,
    prosody: null,
  },
  words: [],
};

class SequenceProvider implements PronunciationAssessmentProvider {
  calls: PronunciationProviderAssessmentInput[] = [];

  constructor(private readonly sequence: readonly unknown[]) {}

  async assess(value: PronunciationProviderAssessmentInput) {
    this.calls.push(value);
    const next =
      this.sequence[Math.min(this.calls.length - 1, this.sequence.length - 1)];
    if (next instanceof Error) throw next;
    return next as PronunciationProviderResult;
  }
}

function harness(sequence: readonly unknown[], providerIdempotent = false) {
  const provider = new SequenceProvider(sequence);
  const starts: unknown[] = [];
  const finishes: any[] = [];
  const ledger: PronunciationProviderAttemptLedger = {
    start: jest.fn(async (value) => starts.push(value)),
    finish: jest.fn(async (value) => {
      finishes.push(value);
      return true;
    }),
  };
  let connection = 0;
  const executor = new PronunciationProviderExecutor(
    provider,
    ledger,
    {
      provider: 'fake',
      modelVersion: 'fake-model-v1',
      adapterVersion: 'fake-adapter-v1',
      apiContractVersion: 'fake-api-v1',
      capabilityVersion: 'fake-capability-v1',
      currency: 'USD',
      priceVersion: 'price-v1',
      providerRequestsIdempotent: providerIdempotent,
    },
    {
      createConnectionId: () => `connection-${++connection}`,
      now: () => new Date('2026-09-10T00:00:01.000Z'),
    },
  );
  return { executor, provider, starts, finishes };
}

describe('pronunciation Provider executor', () => {
  it('makes one normal call and records one unique billable attempt', async () => {
    const { executor, provider, starts, finishes } = harness([success]);
    await expect(executor.execute(input)).resolves.toEqual(success);
    expect(provider.calls).toHaveLength(1);
    expect(starts).toHaveLength(1);
    expect(finishes[0]).toMatchObject({
      attemptNo: 1,
      status: 'SUCCEEDED',
      retryDecision: 'NOT_NEEDED',
      actualCostMicros: 10,
    });
  });

  it.each([
    ['timeout with unknown acceptance', failure('TIMEOUT', null, true)],
    ['accepted 429', failure('RATE_LIMITED', true, true)],
    ['accepted 5xx', failure('SERVICE_ERROR', true, true)],
    ['no match', failure('UNRECOGNIZABLE', true, false)],
  ])('does not automatically retry %s', async (_name, result) => {
    const { executor, provider, finishes } = harness([result, success]);
    await expect(executor.execute(input)).resolves.toEqual(result);
    expect(provider.calls).toHaveLength(1);
    expect(finishes).toHaveLength(1);
  });

  it('does not retry malformed or thrown unknown-acceptance responses', async () => {
    for (const result of [
      { outcome: 'SUCCESS', rawAudio: 'secret' },
      new Error('socket reset'),
    ]) {
      const { executor, provider, finishes } = harness([result, success]);
      await expect(executor.execute(input)).resolves.toMatchObject({
        outcome: 'INVALID_RESPONSE',
        providerAccepted: null,
        retryable: false,
      });
      expect(provider.calls).toHaveLength(1);
      expect(finishes[0]).toMatchObject({
        status: 'INVALID_RESPONSE',
        retryDecision: 'UNKNOWN_ACCEPTANCE_NO_RETRY',
      });
    }
  });

  it('allows at most one automatic retry after proven non-acceptance', async () => {
    const rejected = failure('RATE_LIMITED', false, true);
    const { executor, provider, starts, finishes } = harness([
      rejected,
      rejected,
      success,
    ]);
    await expect(executor.execute(input)).resolves.toEqual(rejected);
    expect(provider.calls).toHaveLength(2);
    expect(starts.map((value: any) => value.attemptNo)).toEqual([1, 2]);
    expect(
      new Set(provider.calls.map((call) => call.applicationConnectionId)).size,
    ).toBe(2);
    expect(finishes.map((value) => value.retryDecision)).toEqual([
      'SAFE_NOT_ACCEPTED',
      'LIMIT_REACHED',
    ]);
  });

  it('allows one retry only when Provider idempotency is explicitly approved', async () => {
    const acceptedFailure = failure('SERVICE_ERROR', true, true);
    const { executor, provider, finishes } = harness(
      [acceptedFailure, success],
      true,
    );
    await expect(executor.execute(input)).resolves.toEqual(success);
    expect(provider.calls).toHaveLength(2);
    expect(finishes.map((value) => value.retryDecision)).toEqual([
      'PROVIDER_IDEMPOTENT',
      'NOT_NEEDED',
    ]);
  });
});
