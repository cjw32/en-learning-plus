import type { PrismaService } from '@libs/shared';
import {
  PrismaPronunciationTraceRepository,
  PronunciationTraceService,
} from '../../src/pronunciation/observability/pronunciation-trace.service';

describe('pronunciation Trace ledger', () => {
  it('links one assessment to ordered steps, Provider call, versions and cost without forbidden fields', async () => {
    const writes: Array<{ model: string; operation: string; input: any }> = [];
    const record = (model: string, operation: string, result: unknown) =>
      jest.fn(async (input: any) => {
        writes.push({ model, operation, input });
        return result;
      });
    const prisma = {
      pronunciationTrace: {
        create: record('trace', 'create', {}),
        update: record('trace', 'update', {}),
      },
      pronunciationTraceStep: {
        create: record('step', 'create', {}),
        updateMany: record('step', 'finish', { count: 1 }),
      },
      pronunciationProviderCall: {
        create: record('provider', 'create', {}),
        updateMany: record('provider', 'finish', { count: 1 }),
      },
    } as unknown as PrismaService;
    const service = new PronunciationTraceService(
      new PrismaPronunciationTraceRepository(prisma),
    );

    await service.createTrace({
      traceId: 'trace_1',
      assessmentId: 'assessment_1',
      traceSubjectId: `pts_${'a'.repeat(64)}`,
      exerciseType: 'PHRASE',
      targetWordCount: 2,
      targetCharacterCount: 11,
      estimatedCostMicros: 20,
      currency: 'USD',
      expiresAt: new Date('2027-03-01T00:00:00Z'),
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
    });
    await service.startStep({
      traceId: 'trace_1',
      sequence: 0,
      stepName: 'UPLOAD',
      metadata: {
        audioByteSize: 1024,
        userId: 'real-user-id',
        targetText: 'raw target text',
        objectKey: 'private/audio.webm',
        audioBytes: Buffer.from('voice'),
      },
    });
    await expect(
      service.finishStep({
        traceId: 'trace_1',
        sequence: 0,
        status: 'SUCCEEDED',
        durationMs: 50,
        metadata: { audioMediaType: 'audio/webm' },
      }),
    ).resolves.toBe(true);
    await service.startProviderCall({
      assessmentId: 'assessment_1',
      attemptNo: 1,
      provider: 'fake',
      modelVersion: 'fake-v1',
      providerAdapterVersion: 'adapter-v1',
      apiContractVersion: 'api-v1',
      capabilityVersion: 'cap-v1',
      applicationConnectionId: 'connection_1',
      inputHash: 'hash_1',
      startedAt: new Date('2026-09-10T00:00:01Z'),
      currency: 'USD',
      priceVersion: 'price-v1',
    });
    await expect(
      service.finishProviderCall({
        assessmentId: 'assessment_1',
        attemptNo: 1,
        status: 'SUCCEEDED',
        providerAccepted: true,
        providerRequestId: 'provider-request-1',
        finishedAt: new Date('2026-09-10T00:00:02Z'),
        latencyMs: 1000,
        billableDurationMs: 900,
        actualCostMicros: 18,
        retryDecision: 'NOT_NEEDED',
        responseHash: 'response-hash',
      }),
    ).resolves.toBe(true);
    await service.finishTrace({
      traceId: 'trace_1',
      terminalStatus: 'COMPLETED',
      totalDurationMs: 2000,
      actualCostMicros: 18,
      confidence: 0.9,
      confidenceTier: 'RELIABLE',
      retryCount: 0,
      cancelled: false,
      timedOut: false,
      degraded: false,
      learningWriteStatus: 'SAVED',
      learningWriteCount: 2,
    });

    const traceCreate = writes.find(
      (item) => item.model === 'trace' && item.operation === 'create',
    )!;
    const providerCreate = writes.find(
      (item) => item.model === 'provider' && item.operation === 'create',
    )!;
    expect(traceCreate.input.data.assessmentId).toBe('assessment_1');
    expect(providerCreate.input.data.assessmentId).toBe('assessment_1');
    expect(traceCreate.input.data).toMatchObject({
      resultSchemaVersion: 'result-v1',
      providerAdapterVersion: 'adapter-v1',
      providerApiVersion: 'api-v1',
      budgetVersion: 'budget-v1',
      priceVersion: 'price-v1',
    });
    const stepCreate = writes.find(
      (item) => item.model === 'step' && item.operation === 'create',
    )!;
    expect(stepCreate.input.data.redactedMetadata).toEqual({
      audioByteSize: 1024,
    });
    const traceFinish = writes.find(
      (item) => item.model === 'trace' && item.operation === 'update',
    )!;
    expect(traceFinish.input.data).toMatchObject({
      actualCost: '0.000018',
      learningWriteCount: 2,
    });

    const publicTraceWrites = JSON.stringify(
      writes.filter((item) => item.model !== 'provider'),
    );
    for (const forbidden of [
      'real-user-id',
      'raw target text',
      'private/audio.webm',
      'voice',
      'provider-request-1',
      'connection_1',
    ])
      expect(publicTraceWrites).not.toContain(forbidden);
  });
});
