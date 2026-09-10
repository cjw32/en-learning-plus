import { PronunciationAudioQualityPolicy } from './pronunciation-audio-quality.policy';

function alternating(
  amplitude: number,
  durationMs: number,
  sampleRate = 16_000,
): Int16Array {
  return Int16Array.from(
    { length: Math.round((durationMs / 1_000) * sampleRate) },
    (_, index) => (index % 2 === 0 ? amplitude : -amplitude),
  );
}

describe('PronunciationAudioQualityPolicy', () => {
  const policy = new PronunciationAudioQualityPolicy();

  it.each([
    ['SILENT', new Int16Array(16_000)],
    ['LOW_VOLUME', alternating(64, 1_000)],
    ['INSUFFICIENT_SPEECH', alternating(1_000, 299)],
    ['READY', alternating(1_000, 300)],
  ])(
    'classifies the calibrated %s boundary deterministically',
    (status, samples) => {
      expect(policy.evaluate({ samples, sampleRate: 16_000 }).status).toBe(
        status,
      );
    },
  );

  it('rejects clipping only beyond the one-percent threshold', () => {
    const boundary = alternating(1_000, 1_000);
    boundary.fill(32_767, 0, 160);
    expect(
      policy.evaluate({ samples: boundary, sampleRate: 16_000 }).status,
    ).toBe('READY');
    boundary[160] = 32_767;
    expect(
      policy.evaluate({ samples: boundary, sampleRate: 16_000 }).status,
    ).toBe('CLIPPED');
  });

  it('does not mutate caller-owned PCM', () => {
    const samples = alternating(1_000, 1_000);
    const before = Int16Array.from(samples);
    policy.evaluate({ samples, sampleRate: 16_000 });
    expect(samples).toEqual(before);
  });
});
