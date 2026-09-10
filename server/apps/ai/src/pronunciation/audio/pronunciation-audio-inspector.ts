/* eslint-disable @typescript-eslint/require-await -- Fail-closed and in-memory port adapters intentionally preserve an async contract without external I/O. */

export const PRONUNCIATION_AUDIO_INSPECTOR = Symbol(
  'PRONUNCIATION_AUDIO_INSPECTOR',
);

export type PronunciationAudioInspection = Readonly<{
  detectedMediaType: string;
  container: string;
  codec: string;
  durationMs: number;
  sampleRate: number;
  channelCount: number;
  qualityStatus:
    | 'READY'
    | 'SILENT'
    | 'LOW_VOLUME'
    | 'CLIPPED'
    | 'INSUFFICIENT_SPEECH';
  canonicalAudio: Uint8Array;
}>;

export type InspectPronunciationAudio = Readonly<{
  bytes: Uint8Array;
  declaredMediaType: string;
  deadlineAt: Date;
  signal?: AbortSignal;
}>;

export interface PronunciationAudioInspector {
  assertRuntimeReady(): Promise<void>;
  inspectAndCanonicalize(
    input: InspectPronunciationAudio,
  ): Promise<PronunciationAudioInspection>;
}

export class PronunciationAudioInspectorUnavailableError extends Error {
  readonly code = 'AUDIO_INVALID';

  constructor() {
    super('Pronunciation audio inspection runtime is unavailable');
    this.name = 'PronunciationAudioInspectorUnavailableError';
  }
}

export class UnavailablePronunciationAudioInspector implements PronunciationAudioInspector {
  async assertRuntimeReady(): Promise<void> {
    throw new PronunciationAudioInspectorUnavailableError();
  }

  async inspectAndCanonicalize(
    _input: InspectPronunciationAudio,
  ): Promise<PronunciationAudioInspection> {
    throw new PronunciationAudioInspectorUnavailableError();
  }
}

export class FakePronunciationAudioInspector implements PronunciationAudioInspector {
  constructor(
    private readonly fixture: Omit<
      PronunciationAudioInspection,
      'canonicalAudio'
    > = {
      detectedMediaType: 'audio/wav',
      container: 'wav',
      codec: 'pcm_s16le',
      durationMs: 1_000,
      sampleRate: 16_000,
      channelCount: 1,
      qualityStatus: 'READY',
    },
  ) {}

  async assertRuntimeReady(): Promise<void> {}

  async inspectAndCanonicalize(
    input: InspectPronunciationAudio,
  ): Promise<PronunciationAudioInspection> {
    if (input.signal?.aborted) throw input.signal.reason;
    return Object.freeze({
      ...this.fixture,
      canonicalAudio: Uint8Array.from(input.bytes),
    });
  }
}
