import {
  PronunciationTraceQueryService,
  type PronunciationTraceQueryRepository,
} from './pronunciation-trace-query.service';

const row = {
  traceId: 'trace-1',
  assessmentId: 'assessment-1',
  terminalStatus: 'COMPLETED' as const,
  uploadDurationMs: 20,
  queueDurationMs: 30,
  decodeDurationMs: 40,
  providerDurationMs: 50,
  totalDurationMs: 140,
  estimatedCost: '0.00010000',
  actualCost: '0.00004000',
  currency: 'USD',
  retryCount: 0,
  cancelled: false,
  timedOut: false,
  degraded: false,
  confidence: '0.950',
  confidenceTier: 'RELIABLE' as const,
  learningWriteStatus: 'SAVED' as const,
  learningWriteCount: 1,
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
      stepName: 'UPLOAD' as const,
      status: 'SUCCEEDED' as const,
      durationMs: 20,
      errorCode: null,
    },
    {
      sequence: 1,
      stepName: 'PROVIDER' as const,
      status: 'SUCCEEDED' as const,
      durationMs: 50,
      errorCode: null,
    },
    {
      sequence: 2,
      stepName: 'SAVE_LEARNING' as const,
      status: 'SUCCEEDED' as const,
      durationMs: 10,
      errorCode: null,
    },
  ],
};

describe('pronunciation owned Trace query', () => {
  it('returns every required latency, cost, status and version dimension', async () => {
    const repository: PronunciationTraceQueryRepository = {
      findOwned: jest.fn(async () => row),
    };
    const result = await new PronunciationTraceQueryService(repository).get(
      'subject-1',
      'assessment-1',
    );
    expect(result).toEqual({
      traceId: 'trace-1',
      assessmentId: 'assessment-1',
      terminalStatus: 'COMPLETED',
      latencyMs: {
        upload: 20,
        queue: 30,
        decode: 40,
        provider: 50,
        total: 140,
      },
      cost: { estimatedMicros: 100, actualMicros: 40, currency: 'USD' },
      retryCount: 0,
      flags: { cancelled: false, timedOut: false, degraded: false },
      confidence: 0.95,
      confidenceTier: 'RELIABLE',
      learning: { status: 'SAVED', writeCount: 1 },
      versions: row.versions,
      steps: row.steps,
    });
    expect(Object.values(result!.versions).every(Boolean)).toBe(true);
    expect(result!.steps.every((step) => step.status !== 'STARTED')).toBe(true);
  });

  it('makes cross-owner and random identifiers indistinguishable', async () => {
    const repository: PronunciationTraceQueryRepository = {
      findOwned: jest.fn(async (subjectId, assessmentId) =>
        subjectId === 'subject-1' && assessmentId === 'assessment-1'
          ? row
          : null,
      ),
    };
    const service = new PronunciationTraceQueryService(repository);
    await expect(service.get('subject-2', 'assessment-1')).resolves.toBeNull();
    await expect(service.get('subject-2', 'random-id')).resolves.toBeNull();
  });

  it('does not expose subject mappings, target text, audio, storage or Provider payloads', async () => {
    const repository: PronunciationTraceQueryRepository = {
      findOwned: jest.fn(async () => row),
    };
    const serialized = JSON.stringify(
      await new PronunciationTraceQueryService(repository).get(
        'real-subject-id',
        'assessment-1',
      ),
    );
    for (const forbidden of [
      'real-subject-id',
      'traceSubjectId',
      'referenceText',
      'recognizedText',
      'audioBytes',
      'objectKey',
      'providerRequestId',
      'rawResponse',
    ])
      expect(serialized).not.toContain(forbidden);
  });
});
