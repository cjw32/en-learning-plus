export type PronunciationAudioQualityStatus =
  | 'READY'
  | 'SILENT'
  | 'LOW_VOLUME'
  | 'CLIPPED'
  | 'INSUFFICIENT_SPEECH';

export type PronunciationAudioQualityResult = Readonly<{
  status: PronunciationAudioQualityStatus;
  rms: number;
  peak: number;
  clippingRatio: number;
  activeSpeechMs: number;
}>;

export type PronunciationAudioQualityPolicyConfig = Readonly<{
  silencePeak: number;
  minimumRms: number;
  clippingAmplitude: number;
  maximumClippingRatio: number;
  activeFrameRms: number;
  minimumActiveSpeechMs: number;
  frameMs: number;
}>;

const defaultConfig: PronunciationAudioQualityPolicyConfig = Object.freeze({
  silencePeak: 0.001,
  minimumRms: 0.01,
  clippingAmplitude: 0.98,
  maximumClippingRatio: 0.01,
  activeFrameRms: 0.015,
  minimumActiveSpeechMs: 300,
  frameMs: 20,
});

function normalized(value: number): number {
  return Math.min(1, Math.abs(value) / 32_768);
}

export class PronunciationAudioQualityPolicy {
  constructor(
    private readonly config: PronunciationAudioQualityPolicyConfig = defaultConfig,
  ) {}

  evaluate(
    input: Readonly<{ samples: Int16Array; sampleRate: number }>,
  ): PronunciationAudioQualityResult {
    if (
      input.samples.length === 0 ||
      !Number.isSafeInteger(input.sampleRate) ||
      input.sampleRate <= 0
    ) {
      return Object.freeze({
        status: 'SILENT',
        rms: 0,
        peak: 0,
        clippingRatio: 0,
        activeSpeechMs: 0,
      });
    }

    let sumSquares = 0;
    let peak = 0;
    let clipped = 0;
    for (const sample of input.samples) {
      const amplitude = normalized(sample);
      sumSquares += amplitude * amplitude;
      peak = Math.max(peak, amplitude);
      if (amplitude >= this.config.clippingAmplitude) clipped += 1;
    }
    const rms = Math.sqrt(sumSquares / input.samples.length);
    const clippingRatio = clipped / input.samples.length;
    const samplesPerFrame = Math.max(
      1,
      Math.round((input.sampleRate * this.config.frameMs) / 1_000),
    );
    let activeSamples = 0;
    for (
      let offset = 0;
      offset < input.samples.length;
      offset += samplesPerFrame
    ) {
      const end = Math.min(input.samples.length, offset + samplesPerFrame);
      let frameEnergy = 0;
      for (let index = offset; index < end; index += 1) {
        const amplitude = normalized(input.samples[index] ?? 0);
        frameEnergy += amplitude * amplitude;
      }
      if (
        Math.sqrt(frameEnergy / (end - offset)) >= this.config.activeFrameRms
      ) {
        activeSamples += end - offset;
      }
    }
    const activeSpeechMs = (activeSamples / input.sampleRate) * 1_000;
    const status: PronunciationAudioQualityStatus =
      peak <= this.config.silencePeak
        ? 'SILENT'
        : rms < this.config.minimumRms
          ? 'LOW_VOLUME'
          : clippingRatio > this.config.maximumClippingRatio
            ? 'CLIPPED'
            : activeSpeechMs < this.config.minimumActiveSpeechMs
              ? 'INSUFFICIENT_SPEECH'
              : 'READY';

    return Object.freeze({ status, rms, peak, clippingRatio, activeSpeechMs });
  }
}
