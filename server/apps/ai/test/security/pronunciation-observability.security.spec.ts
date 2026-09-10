import {
  PRONUNCIATION_PROVIDER_RESULT_SCHEMA_VERSION,
  type PronunciationProviderAssessmentInput,
} from '@en/common/pronunciation';
import { mapPronunciationFailure } from '../../src/pronunciation/observability/pronunciation-failure.mapper';
import { redactPronunciationPayload } from '../../src/pronunciation/observability/pronunciation-redaction';
import {
  PronunciationTraceQueryService,
  type PronunciationTraceQueryRepository,
} from '../../src/pronunciation/observability/pronunciation-trace-query.service';
import { PronunciationProviderExecutor } from '../../src/pronunciation/provider/pronunciation-provider.executor';

describe('pronunciation observability leakage scan', () => {
  it('finds zero forbidden secret, identity, text, audio, storage and raw-response patterns', async () => {
    const forbiddenValues = [
      'subscription-secret',
      'real-subject@example.com',
      'private spoken sentence',
      'voice-byte-sentinel',
      'pronunciation/private/object-key',
      'raw-provider-payload',
    ];
    const metadata = redactPronunciationPayload({
      status: 'COMPLETED',
      subscriptionKey: forbiddenValues[0],
      userId: forbiddenValues[1],
      referenceText: forbiddenValues[2],
      audioBytes: Buffer.from(forbiddenValues[3]),
      objectKey: forbiddenValues[4],
      rawResponse: forbiddenValues[5],
    });
    const publicError = mapPronunciationFailure(
      Object.assign(new Error(forbiddenValues.join('|')), {
        subscriptionKey: forbiddenValues[0],
      }),
    );
    const ledgerWrites: unknown[] = [];
    const providerResult = {
      schemaVersion: PRONUNCIATION_PROVIDER_RESULT_SCHEMA_VERSION,
      provider: 'fake',
      modelVersion: 'model-v1',
      adapterVersion: 'adapter-v1',
      apiContractVersion: 'api-v1',
      capabilityVersion: 'cap-v1',
      providerAccepted: true as const,
      providerRequestId: null,
      latencyMs: 1,
      billableDurationMs: 1_000,
      cost: 0.00001,
      currency: 'USD',
      priceVersion: 'price-v1',
      outcome: 'SUCCESS' as const,
      recognizedText: forbiddenValues[2],
      recognitionConfidence: 0.9,
      scores: {
        overall: 90,
        accuracy: 90,
        completeness: 90,
        fluency: 90,
        prosody: null,
      },
      words: [],
    };
    const executor = new PronunciationProviderExecutor(
      { assess: jest.fn(async () => providerResult) },
      {
        start: jest.fn(async (value) => ledgerWrites.push(value)),
        finish: jest.fn(async (value) => {
          ledgerWrites.push(value);
          return true;
        }),
      },
      {
        provider: 'fake',
        modelVersion: 'model-v1',
        adapterVersion: 'adapter-v1',
        apiContractVersion: 'api-v1',
        capabilityVersion: 'cap-v1',
        currency: 'USD',
        priceVersion: 'price-v1',
        providerRequestsIdempotent: false,
      },
      {
        createConnectionId: () => 'opaque-connection',
        now: () => new Date('2026-09-10T00:00:00Z'),
      },
    );
    const providerInput: PronunciationProviderAssessmentInput = {
      assessmentId: 'assessment-1',
      referenceText: forbiddenValues[2],
      locale: 'en-US',
      canonicalAudio: Buffer.from(forbiddenValues[3]),
      applicationConnectionId: 'ignored',
      deadlineAt: new Date('2026-09-10T00:00:30Z'),
    };
    await executor.execute(providerInput);

    const traceRepository: PronunciationTraceQueryRepository = {
      findOwned: jest.fn(async () => ({
        traceId: 'trace-1',
        assessmentId: 'assessment-1',
        terminalStatus: 'COMPLETED',
        uploadDurationMs: 1,
        queueDurationMs: 1,
        decodeDurationMs: 1,
        providerDurationMs: 1,
        totalDurationMs: 4,
        estimatedCost: '0.00001000',
        actualCost: '0.00001000',
        currency: 'USD',
        retryCount: 0,
        cancelled: false,
        timedOut: false,
        degraded: false,
        confidence: '0.9',
        confidenceTier: 'RELIABLE',
        learningWriteStatus: 'NOT_ELIGIBLE',
        learningWriteCount: 0,
        versions: {
          resultSchema: 'result-v1',
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
        },
        steps: [
          {
            sequence: 0,
            stepName: 'PROVIDER',
            status: 'SUCCEEDED',
            durationMs: 1,
            errorCode: null,
          },
        ],
      })),
    };
    const publicTrace = await new PronunciationTraceQueryService(
      traceRepository,
    ).get(forbiddenValues[1], 'assessment-1');

    const observable = JSON.stringify({
      metadata,
      publicError,
      ledgerWrites,
      publicTrace,
    });
    for (const forbidden of forbiddenValues)
      expect(observable).not.toContain(forbidden);
    expect(observable).not.toMatch(
      /subscriptionKey|userId|referenceText|recognizedText|audioBytes|objectKey|rawResponse/,
    );
  });
});
