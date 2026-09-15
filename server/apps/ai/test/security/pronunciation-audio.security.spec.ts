import {
  FfmpegPronunciationAudioInspector,
  PronunciationAudioProcessLimitError,
  type PronunciationAudioProcessRunner,
} from '../../src/pronunciation/audio/ffmpeg-pronunciation-audio-inspector';
import { PronunciationAudioQualityPolicy } from '../../src/pronunciation/audio/pronunciation-audio-quality.policy';
import { PronunciationUploadGuard } from '../../src/pronunciation/api/pronunciation-upload.guard';

const MiB = 1024 * 1024;

function webm(byteLength = 64): Uint8Array {
  const bytes = new Uint8Array(byteLength);
  bytes.set([0x1a, 0x45, 0xdf, 0xa3]);
  return bytes;
}

function probe(
  durationMs = 1_000,
  overrides: Record<string, unknown> = {},
): Uint8Array {
  return Buffer.from(
    JSON.stringify({
      format: { format_name: 'matroska,webm', duration: durationMs / 1_000 },
      streams: [
        {
          codec_type: 'audio',
          codec_name: 'opus',
          sample_rate: '48000',
          channels: 1,
          ...overrides,
        },
      ],
    }),
  );
}

function canonicalWav(durationMs = 1_000, sample = 1_000): Uint8Array {
  const sampleCount = Math.round((durationMs / 1_000) * 16_000);
  const bytes = new Uint8Array(44 + sampleCount * 2);
  const view = new DataView(bytes.buffer);
  bytes.set(Buffer.from('RIFF'), 0);
  view.setUint32(4, bytes.byteLength - 8, true);
  bytes.set(Buffer.from('WAVEfmt '), 8);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16_000, true);
  view.setUint32(28, 32_000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  bytes.set(Buffer.from('data'), 36);
  view.setUint32(40, sampleCount * 2, true);
  for (let index = 0; index < sampleCount; index += 1) {
    view.setInt16(44 + index * 2, index % 2 === 0 ? sample : -sample, true);
  }
  return bytes;
}

function runnerWith(
  values: readonly Uint8Array[],
): jest.Mocked<PronunciationAudioProcessRunner> {
  const outputs = [...values];
  return {
    run: jest.fn(async () => ({
      exitCode: 0,
      stdout: outputs.shift() ?? new Uint8Array(),
      stderr: new Uint8Array(),
    })),
  };
}

function inspector(runner: PronunciationAudioProcessRunner) {
  return new FfmpegPronunciationAudioInspector(
    {
      approved: true,
      ffprobePath: '/approved/bin/ffprobe',
      ffmpegPath: '/approved/bin/ffmpeg',
      timeoutMs: 2_000,
      maxOutputBytes: 2 * MiB,
      maxMemoryBytes: 64 * MiB,
      maxConcurrent: 1,
    },
    runner,
    new PronunciationAudioQualityPolicy(),
  );
}

describe('pronunciation audio attack and limit boundary', () => {
  it.each([
    ['malformed bytes', Uint8Array.from([1, 2, 3]), 'audio/webm'],
    ['declared type mismatch', webm(), 'audio/mp4'],
    ['oversized input', webm(8 * MiB + 1), 'audio/webm'],
  ])(
    'rejects %s before starting a process',
    async (_name, bytes, mediaType) => {
      const runner = runnerWith([]);
      await expect(
        inspector(runner).inspectAndCanonicalize({
          bytes,
          declaredMediaType: mediaType,
          deadlineAt: new Date(Date.now() + 5_000),
        }),
      ).rejects.toMatchObject({ code: 'AUDIO_INVALID' });
      expect(runner.run).not.toHaveBeenCalled();
    },
  );

  it('rejects polyglot/multi-stream containers before conversion', async () => {
    const runner = runnerWith([
      Buffer.from(
        JSON.stringify({
          format: { format_name: 'matroska,webm', duration: 1 },
          streams: [
            { codec_type: 'audio', codec_name: 'opus', channels: 1 },
            { codec_type: 'video', codec_name: 'png' },
          ],
        }),
      ),
    ]);
    await expect(
      inspector(runner).inspectAndCanonicalize({
        bytes: webm(),
        declaredMediaType: 'audio/webm',
        deadlineAt: new Date(Date.now() + 5_000),
      }),
    ).rejects.toMatchObject({ code: 'AUDIO_INVALID' });
    expect(runner.run).toHaveBeenCalledTimes(1);
  });

  it('maps decode resource exhaustion to a safe rejection and never reaches a Provider', async () => {
    const runner: jest.Mocked<PronunciationAudioProcessRunner> = {
      run: jest
        .fn()
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: probe(),
          stderr: new Uint8Array(),
        })
        .mockRejectedValueOnce(
          new PronunciationAudioProcessLimitError('OUTPUT_LIMIT'),
        ),
    };
    const provider = jest.fn();
    await expect(
      inspector(runner).inspectAndCanonicalize({
        bytes: webm(),
        declaredMediaType: 'audio/webm',
        deadlineAt: new Date(Date.now() + 5_000),
      }),
    ).rejects.toMatchObject({ code: 'AUDIO_INVALID' });
    expect(provider).not.toHaveBeenCalled();
  });

  it.each([500, 30_000])(
    'accepts the exact %d ms boundary after probe, PCM decode and quality checks',
    async (durationMs) => {
      const wav = canonicalWav(durationMs);
      const runner = runnerWith([probe(durationMs), wav.slice(44)]);
      await expect(
        inspector(runner).inspectAndCanonicalize({
          bytes: webm(),
          declaredMediaType: 'audio/webm',
          deadlineAt: new Date(Date.now() + 5_000),
        }),
      ).resolves.toMatchObject({ durationMs, qualityStatus: 'READY' });
      expect(runner.run).toHaveBeenCalledTimes(2);
      for (const call of runner.run.mock.calls) {
        expect(call[0]).toMatchObject({
          shell: false,
          networkDisabled: true,
          maxMemoryBytes: 64 * MiB,
          maxOutputBytes: 2 * MiB,
        });
        expect(call[0].args).not.toContain('-i http://example.test/audio');
      }
    },
  );

  it('accepts browser WebM without container duration and writes a finite canonical WAV header', async () => {
    const metadata = JSON.parse(Buffer.from(probe()).toString());
    delete metadata.format.duration;
    const runner = runnerWith([
      Buffer.from(JSON.stringify(metadata)),
      canonicalWav().slice(44),
    ]);
    const result = await inspector(runner).inspectAndCanonicalize({
      bytes: webm(),
      declaredMediaType: 'audio/webm',
      deadlineAt: new Date(Date.now() + 5000),
    });
    const wav = Buffer.from(result.canonicalAudio);
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.readUInt32LE(4)).toBe(wav.length - 8);
    expect(wav.readUInt32LE(40)).toBe(32000);
    expect(result.durationMs).toBe(1000);
    expect(runner.run.mock.calls[0]![0].args).not.toContain('-nostdin');
    expect(runner.run.mock.calls[1]![0].args).toContain('s16le');
  });
  it.each([499, 30001])(
    'rejects decoded %d ms even when container duration is missing',
    async (durationMs) => {
      const metadata = JSON.parse(Buffer.from(probe()).toString());
      delete metadata.format.duration;
      const runner = runnerWith([
        Buffer.from(JSON.stringify(metadata)),
        canonicalWav(durationMs).slice(44),
      ]);
      await expect(
        inspector(runner).inspectAndCanonicalize({
          bytes: webm(),
          declaredMediaType: 'audio/webm',
          deadlineAt: new Date(Date.now() + 5000),
        }),
      ).rejects.toMatchObject({ code: 'AUDIO_INVALID' });
    },
  );
  it.each([
    ['silence', new Int16Array(16_000), 'SILENT'],
    ['low volume', new Int16Array(16_000).fill(64), 'LOW_VOLUME'],
  ])(
    'rejects %s before Provider invocation',
    async (_name, samples, status) => {
      const provider = jest.fn();
      expect(
        new PronunciationAudioQualityPolicy().evaluate({
          samples,
          sampleRate: 16_000,
        }).status,
      ).toBe(status);
      expect(provider).not.toHaveBeenCalled();
    },
  );

  it('fails closed for an absent or unapproved runtime', async () => {
    const runner = runnerWith([]);
    const audioInspector = new FfmpegPronunciationAudioInspector(
      {
        approved: false,
        ffprobePath: null,
        ffmpegPath: null,
        timeoutMs: 2_000,
        maxOutputBytes: 2 * MiB,
        maxMemoryBytes: 64 * MiB,
        maxConcurrent: 1,
      },
      runner,
      new PronunciationAudioQualityPolicy(),
    );
    await expect(audioInspector.assertRuntimeReady()).rejects.toMatchObject({
      code: 'AUDIO_INVALID',
    });
    expect(runner.run).not.toHaveBeenCalled();
  });

  it.each([
    ['missing identity', undefined, String(1_024), 'AUTH_REQUIRED'],
    [
      'oversized content length',
      { subjectId: 'user-a' },
      String(8 * MiB + 65_537),
      'AUDIO_TOO_LARGE',
    ],
  ])(
    'rejects %s before multipart buffering, object allocation or Provider use',
    async (_name, coachContext, contentLength, code) => {
      const admission = { assertCanBuffer: jest.fn() };
      const guard = new PronunciationUploadGuard(
        { uploadEnabled: true } as never,
        admission,
      );
      const request = {
        coachContext,
        headers: {
          'idempotency-key': 'upload-key-000001',
          'content-length': contentLength,
          'content-type': 'multipart/form-data; boundary=test',
        },
        params: { assessmentId: 'assessment_1' },
      };
      await expect(
        guard.canActivate({
          switchToHttp: () => ({ getRequest: () => request }),
        } as never),
      ).rejects.toMatchObject({ code });
      expect(admission.assertCanBuffer).not.toHaveBeenCalled();
    },
  );

  it('admits an owned bounded upload using authenticated context only', async () => {
    const admission = {
      assertCanBuffer: jest.fn().mockResolvedValue(undefined),
    };
    const guard = new PronunciationUploadGuard(
      { uploadEnabled: true } as never,
      admission,
    );
    await expect(
      guard.canActivate({
        switchToHttp: () => ({
          getRequest: () => ({
            coachContext: { subjectId: 'user-a' },
            headers: {
              'idempotency-key': 'upload-key-000001',
              'content-length': '4096',
              'content-type': 'multipart/form-data; boundary=test',
            },
            params: { assessmentId: 'assessment_1' },
          }),
        }),
      } as never),
    ).resolves.toBe(true);
    expect(admission.assertCanBuffer).toHaveBeenCalledWith({
      subjectId: 'user-a',
      assessmentId: 'assessment_1',
    });
  });

  it('rejects a missing upload idempotency key before multipart buffering', async () => {
    const admission = { assertCanBuffer: jest.fn() };
    const guard = new PronunciationUploadGuard(
      { uploadEnabled: true } as never,
      admission,
    );

    await expect(
      guard.canActivate({
        switchToHttp: () => ({
          getRequest: () => ({
            coachContext: { subjectId: 'user-a' },
            headers: {
              'content-length': '4096',
              'content-type': 'multipart/form-data; boundary=test',
            },
            params: { assessmentId: 'assessment_1' },
          }),
        }),
      } as never),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(admission.assertCanBuffer).not.toHaveBeenCalled();
  });
});
