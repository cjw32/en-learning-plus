import {
  PRONUNCIATION_CONTRACT_VERSIONS as versions,
  PRONUNCIATION_PROVIDER_RESULT_SCHEMA_VERSION,
} from '@en/common/pronunciation';
import { PronunciationAssessmentWorkerExecutor } from './pronunciation-assessment.executor';
import { PronunciationBudgetError } from '../governance/pronunciation-budget.service';

function setup() {
  const controller = new AbortController();
  const owned = {
    assessment: {
      status: 'PROCESSING',
      exerciseType: 'WORD',
      deadlineAt: new Date(Date.now() + 60000),
    },
    target: {
      referenceText: 'hello',
      normalizedTokens: ['hello'],
      languageTag: 'en-US',
    },
    audio: {
      status: 'READY',
      durationMs: 1000,
      expiresAt: new Date(Date.now() + 86400000),
      objectKey: 'private.wav',
    },
    learningWriteStatus: 'NOT_ELIGIBLE',
  };
  const prisma = {
    pronunciationAssessment: {
      findUnique: jest.fn(async () => ({
        userId: 'owner',
        queuedAt: new Date(),
        startedAt: new Date(),
      })),
      updateMany: jest.fn(),
    },
    pronunciationTrace: { update: jest.fn() },
    pronunciationProviderCall: { updateMany: jest.fn() },
    learnerProfile: {
      findUnique: jest.fn(async () => ({ timezone: 'Asia/Shanghai' })),
    },
  };
  const result = {
    schemaVersion: PRONUNCIATION_PROVIDER_RESULT_SCHEMA_VERSION,
    provider: 'azure',
    modelVersion: 'model-v1',
    adapterVersion: versions.providerAdapter,
    apiContractVersion: versions.providerApi,
    capabilityVersion: versions.providerCapability,
    providerAccepted: true,
    providerRequestId: 'provider-1',
    latencyMs: 10,
    billableDurationMs: 1000,
    cost: 0.001,
    currency: 'USD',
    priceVersion: 'price-v1',
    outcome: 'SUCCESS',
    recognizedText: 'hello',
    recognitionConfidence: 0.95,
    scores: {
      overall: 90,
      accuracy: 90,
      completeness: 100,
      fluency: 90,
      prosody: null,
    },
    words: [
      {
        sequence: 0,
        lexicalForm: 'hello',
        offsetMs: 0,
        durationMs: 800,
        score: 90,
        errorType: 'NONE',
      },
    ],
  };
  const adapters = {
    config: {
      providerModelVersion: 'model-v1',
      budgetPolicyVersion: 'budget-v1',
      priceVersion: 'price-v1',
      maxCallCostMicros: 5000,
      learningWriteEnabled: false,
    },
    currency: 'USD',
    storage: { read: jest.fn(async () => new Uint8Array([1, 2])) },
    provider: { assess: jest.fn(async () => result) },
  };
  const repository = { findOwnedWithTarget: jest.fn(async () => owned) };
  const assessments = {
    assertExecutionBoundary: jest.fn(async () => owned),
    finalizeResult: jest.fn(),
  };
  const cancellations = {
    abortSignalFor: () => controller.signal,
    observe: jest.fn(),
    assertCanFinalize: jest.fn(),
    clear: jest.fn(),
  };
  const admission = { release: jest.fn(async () => undefined) };
  const traces = {
    createTrace: jest.fn(),
    startProviderCall: jest.fn(),
    finishProviderCall: jest.fn(async () => true),
    finishTrace: jest.fn(),
  };
  const executor = new PronunciationAssessmentWorkerExecutor(
    prisma as never,
    repository as never,
    assessments as never,
    adapters as never,
    cancellations as never,
    admission as never,
    traces as never,
    { get: () => 'local-test-pepper' } as never,
  );
  return {
    executor,
    owned,
    prisma,
    adapters,
    assessments,
    cancellations,
    admission,
    traces,
    controller,
  };
}

describe('production pronunciation worker execution', () => {
  it('reads canonical audio, records the call, assembles word feedback and finalizes through the learning workflow', async () => {
    const s = setup();
    await s.executor.executeAssessment('assessment-1');
    expect(s.adapters.provider.assess).toHaveBeenCalledTimes(1);
    expect(s.traces.startProviderCall).toHaveBeenCalledTimes(1);
    expect(s.traces.finishProviderCall).toHaveBeenCalledWith(
      expect.objectContaining({ actualCostMicros: 1000, status: 'SUCCEEDED' }),
    );
    expect(s.assessments.finalizeResult).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectId: 'owner',
        result: expect.objectContaining({
          scores: expect.objectContaining({ overall: 90, prosody: null }),
          words: [
            expect.objectContaining({ word: 'hello', status: 'correct' }),
          ],
        }),
      }),
    );
    expect(s.admission.release).toHaveBeenCalledWith('owner', 'assessment-1');
  });
  it('does not call the provider when audio has expired', async () => {
    const s = setup();
    s.owned.audio.expiresAt = new Date(0);
    await s.executor.executeAssessment('assessment-1');
    expect(s.adapters.provider.assess).not.toHaveBeenCalled();
    expect(s.prisma.pronunciationAssessment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'REJECTED',
          publicErrorCode: 'AUDIO_INVALID',
        }),
      }),
    );
  });
  it('keeps budget refusal distinct and closes the attempt ledger without scoring', async () => {
    const s = setup();
    s.adapters.provider.assess.mockRejectedValue(
      new PronunciationBudgetError('BUDGET_EXCEEDED'),
    );
    await s.executor.executeAssessment('assessment-1');
    expect(s.adapters.provider.assess).toHaveBeenCalledTimes(1);
    expect(s.assessments.finalizeResult).not.toHaveBeenCalled();
    expect(s.traces.finishProviderCall).toHaveBeenCalledWith(
      expect.objectContaining({
        providerAccepted: false,
        actualCostMicros: 0,
        failureCode: 'BUDGET_EXCEEDED',
      }),
    );
    expect(s.prisma.pronunciationAssessment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ publicErrorCode: 'BUDGET_EXCEEDED' }),
      }),
    );
  });
  it('discards a late provider result after durable cancellation wins', async () => {
    const s = setup();
    s.cancellations.assertCanFinalize
      .mockImplementationOnce(async () => {})
      .mockImplementationOnce(async () => {
        s.controller.abort();
        throw Object.assign(new Error(), { code: 'CANCELLED' });
      });
    await s.executor.executeAssessment('assessment-1');
    expect(s.assessments.finalizeResult).not.toHaveBeenCalled();
    expect(s.prisma.pronunciationProviderCall.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { lateResultDiscardedAt: expect.any(Date) },
      }),
    );
    expect(s.prisma.pronunciationAssessment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'PROCESSING',
          hiddenAt: null,
          cancelRequestedAt: null,
        }),
      }),
    );
  });
  it('does not save malformed provider output or retry unknown acceptance', async () => {
    const s = setup();
    s.adapters.provider.assess.mockResolvedValue({ raw: 'invalid' } as never);
    await s.executor.executeAssessment('assessment-1');
    expect(s.adapters.provider.assess).toHaveBeenCalledTimes(1);
    expect(s.assessments.finalizeResult).not.toHaveBeenCalled();
  });
});
