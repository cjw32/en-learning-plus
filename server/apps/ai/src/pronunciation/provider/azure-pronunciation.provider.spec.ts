import {
  AzurePronunciationApprovalError,
  AzurePronunciationAssessmentProvider,
  type AzurePronunciationCostGate,
  type AzurePronunciationProviderConfig,
} from './azure-pronunciation.provider';

function wav(durationMs = 1_000): Uint8Array {
  const dataSize = Math.round(durationMs * 32);
  const bytes = new Uint8Array(44 + dataSize);
  const view = new DataView(bytes.buffer);
  bytes.set(Buffer.from('RIFF'), 0);
  view.setUint32(4, 36 + dataSize, true);
  bytes.set(Buffer.from('WAVEfmt '), 8);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16_000, true);
  view.setUint32(28, 32_000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  bytes.set(Buffer.from('data'), 36);
  view.setUint32(40, dataSize, true);
  return bytes;
}

const config: AzurePronunciationProviderConfig = {
  enabled: true,
  providerApproved: true,
  resourceName: 'pronunciation-test',
  subscriptionKey: 'not-a-real-key',
  region: 'eastasia',
  approvedRegion: 'eastasia',
  privacyEvidenceVersion: 'privacy-2026-09',
  modelVersion: 'vendor-attested-model-2026-09',
  modelIdentityEvidenceVersion: 'model-evidence-2026-09',
  modelIdentityVendorAttested: true,
  modelIdentityImmutable: true,
  modelIdentityQueryable: true,
  adapterVersion: 'azure-rest-adapter.v1',
  apiContractVersion: 'azure-short-audio-rest.2026-06-05',
  capabilityVersion: 'pronunciation-scripted-word.v1',
  priceVersion: 'price-2026-09',
  budgetPolicyVersion: 'budget-2026-09',
  currency: 'USD',
  prosodyApproved: false,
};

function input(locale: 'en-US' | 'en-GB' = 'en-US') {
  return {
    assessmentId: 'assessment_1',
    referenceText: 'Good morning.',
    locale,
    canonicalAudio: wav(),
    applicationConnectionId: 'private-application-connection',
    deadlineAt: new Date(Date.now() + 60_000),
  } as const;
}

function successfulAzureResponse(prosody = 87.8) {
  return {
    RecognitionStatus: 'Success',
    Offset: 700_000,
    Duration: 8_400_000,
    NBest: [
      {
        Confidence: 0.98,
        Lexical: 'good morning',
        ITN: 'good morning',
        MaskedITN: 'good morning',
        Display: 'Good morning.',
        AccuracyScore: 96,
        FluencyScore: 91,
        CompletenessScore: 100,
        PronScore: 94,
        ProsodyScore: prosody,
        Words: [
          {
            Word: 'good',
            Offset: 700_000,
            Duration: 2_600_000,
            AccuracyScore: 95,
            ErrorType: 'None',
          },
          {
            Word: 'morning',
            Offset: 3_400_000,
            Duration: 5_700_000,
            AccuracyScore: 90,
            ErrorType: 'Mispronunciation',
          },
        ],
      },
    ],
  };
}

function costGate() {
  const gate: jest.Mocked<AzurePronunciationCostGate> = {
    reserve: jest.fn().mockResolvedValue({
      reservationId: 'reservation_1',
      estimatedCostMicros: 12,
      currency: 'USD',
      priceVersion: 'price-2026-09',
      budgetPolicyVersion: 'budget-2026-09',
    }),
    settle: jest.fn().mockResolvedValue(undefined),
    release: jest.fn().mockResolvedValue(undefined),
  };
  return gate;
}

describe('AzurePronunciationAssessmentProvider', () => {
  it('sends only canonical audio and the documented minimal assessment request', async () => {
    const gate = costGate();
    const fetchMock = jest.fn().mockResolvedValue(
      new Response(JSON.stringify(successfulAzureResponse()), {
        status: 200,
        headers: { 'x-requestid': 'azure-request-1' },
      }),
    );
    const provider = new AzurePronunciationAssessmentProvider(
      config,
      gate,
      fetchMock,
    );

    const result = await provider.assess(input());

    expect(result).toMatchObject({
      outcome: 'SUCCESS',
      provider: 'azure',
      providerRequestId: 'azure-request-1',
      scores: { prosody: null },
      billableDurationMs: 1_000,
      cost: 0.000012,
    });
    expect(gate.reserve).toHaveBeenCalledWith(
      expect.objectContaining({
        capability: 'BASE',
        durationMs: 1_000,
        region: 'eastasia',
        modelVersion: 'vendor-attested-model-2026-09',
      }),
    );
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://pronunciation-test.cognitiveservices.azure.com/stt/speech/recognition/conversation/cognitiveservices/v1?language=en-US&format=detailed',
    );
    expect(request.method).toBe('POST');
    expect(request.body).toEqual(input().canonicalAudio);
    expect(request.headers).toEqual({
      Accept: 'application/json',
      'Content-Type': 'audio/wav; codecs=audio/pcm; samplerate=16000',
      'Ocp-Apim-Subscription-Key': 'not-a-real-key',
      'Pronunciation-Assessment': expect.any(String),
    });
    expect(JSON.stringify(request)).not.toContain('assessment_1');
    expect(JSON.stringify(request)).not.toContain(
      'private-application-connection',
    );
    const encoded = (request.headers as Record<string, string>)[
      'Pronunciation-Assessment'
    ];
    expect(JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'))).toEqual(
      {
        ReferenceText: 'Good morning.',
        GradingSystem: 'HundredMark',
        Granularity: 'Word',
        Dimension: 'Comprehensive',
        EnableMiscue: 'True',
      },
    );
    expect(gate.settle).toHaveBeenCalledWith('reservation_1', 12);
  });

  it('requests and exposes prosody only for separately approved en-US calls', async () => {
    const gate = costGate();
    const fetchMock = jest.fn().mockResolvedValue(
      new Response(JSON.stringify(successfulAzureResponse()), {
        status: 200,
      }),
    );
    const provider = new AzurePronunciationAssessmentProvider(
      { ...config, prosodyApproved: true },
      gate,
      fetchMock,
    );
    const result = await provider.assess(input('en-US'));
    expect(result).toMatchObject({
      outcome: 'SUCCESS',
      scores: { prosody: 87.8 },
    });
    expect(gate.reserve).toHaveBeenCalledWith(
      expect.objectContaining({ capability: 'PROSODY' }),
    );
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    const encoded = (request.headers as Record<string, string>)[
      'Pronunciation-Assessment'
    ];
    expect(
      JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')),
    ).toMatchObject({ EnableProsodyAssessment: 'True' });
  });

  it('forces null prosody for en-GB even if Azure unexpectedly returns it', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      new Response(JSON.stringify(successfulAzureResponse()), {
        status: 200,
      }),
    );
    const provider = new AzurePronunciationAssessmentProvider(
      { ...config, prosodyApproved: true },
      costGate(),
      fetchMock,
    );
    const result = await provider.assess(input('en-GB'));
    expect(result).toMatchObject({
      outcome: 'SUCCESS',
      scores: { prosody: null },
    });
  });

  it('aborts at the 30-second adapter ceiling without live Azure access', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(Date.parse('2026-09-10T00:00:00.000Z'));
    try {
      const fetchMock = jest.fn(
        (_url: unknown, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              'abort',
              () =>
                reject(
                  init.signal?.reason instanceof Error
                    ? init.signal.reason
                    : new Error('aborted'),
                ),
              { once: true },
            );
          }),
      );
      const provider = new AzurePronunciationAssessmentProvider(
        config,
        costGate(),
        fetchMock,
      );
      const pending = provider.assess({
        ...input(),
        deadlineAt: new Date(Date.now() + 60_000),
      });
      await jest.advanceTimersByTimeAsync(29_999);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(1);
      await expect(pending).resolves.toMatchObject({
        outcome: 'TIMEOUT',
        latencyMs: 30_000,
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it.each([
    ['modelVersion', null],
    ['modelIdentityEvidenceVersion', 'placeholder'],
    ['modelIdentityVendorAttested', false],
    ['modelIdentityImmutable', false],
    ['modelIdentityQueryable', false],
    ['approvedRegion', 'westus'],
    ['privacyEvidenceVersion', null],
    ['priceVersion', null],
    ['budgetPolicyVersion', null],
  ] as const)(
    'fails closed before fetch when %s is not approved',
    async (key, value) => {
      const fetchMock = jest.fn();
      expect(
        () =>
          new AzurePronunciationAssessmentProvider(
            { ...config, [key]: value },
            costGate(),
            fetchMock,
          ),
      ).toThrow(AzurePronunciationApprovalError);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('rejects malformed or overlong non-canonical audio before reserving budget', async () => {
    const gate = costGate();
    const fetchMock = jest.fn();
    const provider = new AzurePronunciationAssessmentProvider(
      config,
      gate,
      fetchMock,
    );
    await expect(
      provider.assess({
        ...input(),
        canonicalAudio: Uint8Array.from([1, 2, 3]),
      }),
    ).rejects.toMatchObject({ code: 'AUDIO_INVALID' });
    await expect(
      provider.assess({ ...input(), canonicalAudio: wav(30_001) }),
    ).rejects.toMatchObject({ code: 'AUDIO_INVALID' });
    expect(gate.reserve).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps malformed success bodies to INVALID_RESPONSE without leaking raw data', async () => {
    const provider = new AzurePronunciationAssessmentProvider(
      config,
      costGate(),
      jest.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            RecognitionStatus: 'Success',
            NBest: [{ Lexical: 'secret raw vendor response' }],
          }),
          { status: 200 },
        ),
      ),
    );
    const result = await provider.assess(input());
    expect(result).toMatchObject({ outcome: 'INVALID_RESPONSE' });
    expect(JSON.stringify(result)).not.toContain('secret raw vendor response');
  });
});
