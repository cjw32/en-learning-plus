/* eslint-disable @typescript-eslint/require-await -- Fail-closed and deterministic fake providers intentionally preserve the production async port. */

import {
  PRONUNCIATION_PROVIDER_RESULT_SCHEMA_VERSION,
  type PronunciationProviderAssessmentInput,
  type PronunciationProviderResult,
  pronunciationProviderResultSchema,
} from '@en/common/pronunciation';

export const PRONUNCIATION_ASSESSMENT_PROVIDER = Symbol(
  'PRONUNCIATION_ASSESSMENT_PROVIDER',
);

export interface PronunciationAssessmentProvider {
  assess(
    input: PronunciationProviderAssessmentInput,
    signal?: AbortSignal,
  ): Promise<PronunciationProviderResult>;
}

export class PronunciationProviderUnavailableError extends Error {
  readonly code = 'PROVIDER_NOT_APPROVED';

  constructor() {
    super('Pronunciation assessment Provider is unavailable');
    this.name = 'PronunciationProviderUnavailableError';
  }
}

export class UnavailablePronunciationAssessmentProvider implements PronunciationAssessmentProvider {
  async assess(
    _input: PronunciationProviderAssessmentInput,
    _signal?: AbortSignal,
  ): Promise<PronunciationProviderResult> {
    throw new PronunciationProviderUnavailableError();
  }
}

export class FakePronunciationAssessmentProvider implements PronunciationAssessmentProvider {
  private readonly received: PronunciationProviderAssessmentInput[] = [];

  constructor(
    private readonly resultFactory: (
      input: PronunciationProviderAssessmentInput,
    ) => PronunciationProviderResult = (input) => ({
      schemaVersion: PRONUNCIATION_PROVIDER_RESULT_SCHEMA_VERSION,
      provider: 'fake',
      modelVersion: 'fake-model.v1',
      adapterVersion: 'fake-adapter.v1',
      apiContractVersion: 'fake-api.v1',
      capabilityVersion: 'fake-capability.v1',
      providerAccepted: true,
      providerRequestId: `fake-${input.assessmentId}`,
      latencyMs: 1,
      billableDurationMs: 0,
      cost: 0,
      currency: 'USD',
      priceVersion: 'fake-price.v1',
      outcome: 'SUCCESS',
      recognizedText: input.referenceText,
      recognitionConfidence: 1,
      scores: {
        overall: 100,
        accuracy: 100,
        completeness: 100,
        fluency: 100,
        prosody: null,
      },
      words: [],
    }),
  ) {}

  get callCount(): number {
    return this.received.length;
  }

  get calls(): readonly PronunciationProviderAssessmentInput[] {
    return this.received.map((input) =>
      Object.freeze({
        ...input,
        canonicalAudio: Uint8Array.from(input.canonicalAudio),
        deadlineAt: new Date(input.deadlineAt),
      }),
    );
  }

  async assess(
    input: PronunciationProviderAssessmentInput,
    signal?: AbortSignal,
  ): Promise<PronunciationProviderResult> {
    if (signal?.aborted) throw signal.reason;
    this.received.push({
      ...input,
      canonicalAudio: Uint8Array.from(input.canonicalAudio),
      deadlineAt: new Date(input.deadlineAt),
    });
    return pronunciationProviderResultSchema.parse(this.resultFactory(input));
  }
}
