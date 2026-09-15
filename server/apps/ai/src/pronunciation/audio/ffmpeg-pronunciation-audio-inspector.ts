import { spawn } from 'node:child_process';
import {
  PronunciationAudioInspectorUnavailableError,
  type InspectPronunciationAudio,
  type PronunciationAudioInspection,
  type PronunciationAudioInspector,
} from './pronunciation-audio-inspector';
import { PronunciationAudioQualityPolicy } from './pronunciation-audio-quality.policy';

const MAX_INPUT_BYTES = 8 * 1024 * 1024;
const MIN_DURATION_MS = 500;
const MAX_DURATION_MS = 30_000;

export type PronunciationAudioProcessRequest = Readonly<{
  executable: string;
  args: readonly string[];
  stdin: Uint8Array;
  timeoutMs: number;
  maxOutputBytes: number;
  maxMemoryBytes: number;
  shell: false;
  networkDisabled: true;
  signal?: AbortSignal;
}>;

export type PronunciationAudioProcessResult = Readonly<{
  exitCode: number;
  stdout: Uint8Array;
  stderr: Uint8Array;
}>;

export interface PronunciationAudioProcessRunner {
  run(
    request: PronunciationAudioProcessRequest,
  ): Promise<PronunciationAudioProcessResult>;
}

export class PronunciationAudioProcessLimitError extends Error {
  constructor(readonly reason: 'TIMEOUT' | 'OUTPUT_LIMIT' | 'ABORTED') {
    super(`Pronunciation audio process stopped: ${reason}`);
    this.name = 'PronunciationAudioProcessLimitError';
  }
}

export class NodePronunciationAudioProcessRunner implements PronunciationAudioProcessRunner {
  async run(
    request: PronunciationAudioProcessRequest,
  ): Promise<PronunciationAudioProcessResult> {
    if (
      request.signal?.aborted ||
      request.shell !== false ||
      request.networkDisabled !== true
    ) {
      throw new PronunciationAudioProcessLimitError('ABORTED');
    }
    return new Promise((resolve, reject) => {
      const child = spawn(request.executable, [...request.args], {
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' },
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let outputBytes = 0;
      let settled = false;
      const finish = (action: () => void, kill = false): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        request.signal?.removeEventListener('abort', onAbort);
        if (kill) child.kill('SIGKILL');
        action();
      };
      const onAbort = (): void =>
        finish(
          () => reject(new PronunciationAudioProcessLimitError('ABORTED')),
          true,
        );
      const collect = (target: Buffer[]) => (chunk: Buffer) => {
        outputBytes += chunk.byteLength;
        if (outputBytes > request.maxOutputBytes) {
          finish(
            () =>
              reject(new PronunciationAudioProcessLimitError('OUTPUT_LIMIT')),
            true,
          );
          return;
        }
        target.push(Buffer.from(chunk));
      };
      const timer = setTimeout(
        () =>
          finish(
            () => reject(new PronunciationAudioProcessLimitError('TIMEOUT')),
            true,
          ),
        request.timeoutMs,
      );
      request.signal?.addEventListener('abort', onAbort, { once: true });
      child.stdout.on('data', collect(stdout));
      child.stderr.on('data', collect(stderr));
      child.once('error', (error) => finish(() => reject(error)));
      child.once('close', (code) =>
        finish(() =>
          resolve({
            exitCode: code ?? -1,
            stdout: Buffer.concat(stdout),
            stderr: Buffer.concat(stderr),
          }),
        ),
      );
      child.stdin.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code !== 'EPIPE') finish(() => reject(error), true);
      });
      if (request.signal?.aborted) onAbort();
      else child.stdin.end(Buffer.from(request.stdin));
    });
  }
}

export type FfmpegPronunciationAudioInspectorConfig = Readonly<{
  approved: boolean;
  ffprobePath: string | null;
  ffmpegPath: string | null;
  timeoutMs: number;
  maxOutputBytes: number;
  maxMemoryBytes: number;
  maxConcurrent: number;
}>;

type Probe = Readonly<{
  mediaType: 'audio/webm' | 'audio/mp4' | 'audio/wav';
  container: string;
  codec: string;
  durationMs: number | null;
  sampleRate: number;
  channelCount: number;
}>;

function invalid(): PronunciationAudioInspectorUnavailableError {
  return new PronunciationAudioInspectorUnavailableError();
}

function configuredPath(value: string | null): value is string {
  return Boolean(value?.startsWith('/') && !value.includes('\0'));
}

function declaredType(value: string): 'audio/webm' | 'audio/mp4' | null {
  const normalized = value.toLowerCase().split(';', 1)[0]?.trim();
  return normalized === 'audio/webm' || normalized === 'audio/mp4'
    ? normalized
    : null;
}

function signatureType(bytes: Uint8Array): 'audio/webm' | 'audio/mp4' | null {
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  ) {
    return 'audio/webm';
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(4, 8)) === 'ftyp'
  ) {
    return 'audio/mp4';
  }
  return null;
}

function parseProbe(bytes: Uint8Array): Probe {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch {
    throw invalid();
  }
  if (!value || typeof value !== 'object') throw invalid();
  const record = value as {
    format?: { format_name?: unknown; duration?: unknown };
    streams?: unknown[];
  };
  if (!Array.isArray(record.streams) || record.streams.length !== 1) {
    throw invalid();
  }
  const stream = record.streams[0] as Record<string, unknown>;
  if (stream.codec_type !== 'audio') throw invalid();
  const format =
    typeof record.format?.format_name === 'string'
      ? record.format.format_name
      : '';
  const codec = typeof stream.codec_name === 'string' ? stream.codec_name : '';
  const durationMs =
    record.format?.duration === undefined || record.format.duration === 'N/A'
      ? null
      : Number(record.format.duration) * 1_000;
  const sampleRate = Number(stream.sample_rate);
  const channelCount = Number(stream.channels);
  if (
    (durationMs !== null &&
      (!Number.isFinite(durationMs) ||
        durationMs <= 0 ||
        durationMs > MAX_DURATION_MS + 100)) ||
    !Number.isSafeInteger(sampleRate) ||
    sampleRate < 8000 ||
    sampleRate > 192000 ||
    !Number.isSafeInteger(channelCount) ||
    channelCount <= 0 ||
    channelCount > 2
  ) {
    throw invalid();
  }
  const mediaType = format.includes('wav')
    ? 'audio/wav'
    : format.includes('webm') || format.includes('matroska')
      ? 'audio/webm'
      : format.includes('mp4') || format.includes('mov')
        ? 'audio/mp4'
        : null;
  if (!mediaType) throw invalid();
  const validCodec =
    (mediaType === 'audio/webm' && codec === 'opus') ||
    (mediaType === 'audio/mp4' && codec === 'aac') ||
    (mediaType === 'audio/wav' && codec === 'pcm_s16le');
  if (!validCodec) throw invalid();
  return Object.freeze({
    mediaType,
    container: format,
    codec,
    durationMs: durationMs === null ? null : Math.round(durationMs),
    sampleRate,
    channelCount,
  });
}

/** ffmpeg's streaming WAV has unknown lengths. Decode raw PCM and own the WAV header. */
function canonicalWav(pcm: Uint8Array): {
  audio: Uint8Array;
  samples: Int16Array;
  durationMs: number;
} {
  const durationMs = pcm.byteLength / 32;
  if (
    pcm.byteLength % 2 ||
    durationMs < MIN_DURATION_MS ||
    durationMs > MAX_DURATION_MS
  )
    throw invalid();
  const audio = Buffer.alloc(44 + pcm.byteLength);
  audio.write('RIFF', 0);
  audio.writeUInt32LE(audio.length - 8, 4);
  audio.write('WAVEfmt ', 8);
  audio.writeUInt32LE(16, 16);
  audio.writeUInt16LE(1, 20);
  audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(16000, 24);
  audio.writeUInt32LE(32000, 28);
  audio.writeUInt16LE(2, 32);
  audio.writeUInt16LE(16, 34);
  audio.write('data', 36);
  audio.writeUInt32LE(pcm.byteLength, 40);
  audio.set(pcm, 44);
  const samples = new Int16Array(pcm.byteLength / 2);
  for (let index = 0; index < samples.length; index++)
    samples[index] = audio.readInt16LE(44 + index * 2);
  return { audio, samples, durationMs: Math.round(durationMs) };
}

export class FfmpegPronunciationAudioInspector implements PronunciationAudioInspector {
  private active = 0;

  constructor(
    private readonly config: FfmpegPronunciationAudioInspectorConfig,
    private readonly runner: PronunciationAudioProcessRunner = new NodePronunciationAudioProcessRunner(),
    private readonly qualityPolicy = new PronunciationAudioQualityPolicy(),
  ) {}

  private configuredPaths(): Readonly<{
    ffprobePath: string;
    ffmpegPath: string;
  }> {
    if (
      !this.config.approved ||
      !configuredPath(this.config.ffprobePath) ||
      !configuredPath(this.config.ffmpegPath) ||
      !Number.isSafeInteger(this.config.timeoutMs) ||
      this.config.timeoutMs <= 0 ||
      !Number.isSafeInteger(this.config.maxOutputBytes) ||
      this.config.maxOutputBytes <= 0 ||
      !Number.isSafeInteger(this.config.maxMemoryBytes) ||
      this.config.maxMemoryBytes <= 0 ||
      !Number.isSafeInteger(this.config.maxConcurrent) ||
      this.config.maxConcurrent <= 0
    ) {
      throw invalid();
    }
    return {
      ffprobePath: this.config.ffprobePath,
      ffmpegPath: this.config.ffmpegPath,
    };
  }

  async assertRuntimeReady(): Promise<void> {
    const paths = this.configuredPaths();
    for (const executable of [paths.ffprobePath, paths.ffmpegPath]) {
      const result = await this.run({
        executable,
        args: ['-version'],
        stdin: new Uint8Array(),
      });
      if (result.exitCode !== 0) throw invalid();
    }
  }

  async inspectAndCanonicalize(
    input: InspectPronunciationAudio,
  ): Promise<PronunciationAudioInspection> {
    const paths = this.configuredPaths();
    const mediaType = declaredType(input.declaredMediaType);
    if (
      input.bytes.byteLength === 0 ||
      input.bytes.byteLength > MAX_INPUT_BYTES ||
      !mediaType ||
      signatureType(input.bytes) !== mediaType ||
      input.signal?.aborted ||
      input.deadlineAt.getTime() <= Date.now()
    ) {
      throw invalid();
    }
    if (this.active >= this.config.maxConcurrent) throw invalid();
    this.active += 1;
    const controller = new AbortController();
    const abort = () => controller.abort();
    input.signal?.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(
      abort,
      Math.min(this.config.timeoutMs, input.deadlineAt.getTime() - Date.now()),
    );
    try {
      const initial = parseProbe(
        (
          await this.run({
            executable: paths.ffprobePath,
            args: [
              '-v',
              'error',
              '-max_alloc',
              String(this.config.maxMemoryBytes),
              '-protocol_whitelist',
              'pipe',
              '-show_entries',
              'format=format_name,duration:stream=codec_type,codec_name,sample_rate,channels',
              '-of',
              'json',
              '-i',
              'pipe:0',
            ],
            stdin: input.bytes,
            signal: controller.signal,
          })
        ).stdout,
      );
      if (initial.mediaType !== mediaType) throw invalid();
      const converted = await this.run({
        executable: paths.ffmpegPath,
        args: [
          '-v',
          'error',
          '-nostdin',
          '-protocol_whitelist',
          'pipe',
          '-max_alloc',
          String(this.config.maxMemoryBytes),
          '-threads',
          '1',
          '-i',
          'pipe:0',
          '-t',
          '30.1',
          '-map_metadata',
          '-1',
          '-map',
          '0:a:0',
          '-vn',
          '-sn',
          '-dn',
          '-ac',
          '1',
          '-ar',
          '16000',
          '-sample_fmt',
          's16',
          '-c:a',
          'pcm_s16le',
          '-threads',
          '1',
          '-f',
          's16le',
          'pipe:1',
        ],
        stdin: input.bytes,
        signal: controller.signal,
      });
      if (converted.exitCode !== 0) throw invalid();
      const decoded = canonicalWav(converted.stdout);
      if (
        initial.durationMs !== null &&
        Math.abs(decoded.durationMs - initial.durationMs) > 150
      )
        throw invalid();
      const quality = this.qualityPolicy.evaluate({
        samples: decoded.samples,
        sampleRate: 16_000,
      });
      return Object.freeze({
        detectedMediaType: initial.mediaType,
        container: initial.container,
        codec: initial.codec,
        durationMs: decoded.durationMs,
        sampleRate: 16000,
        channelCount: 1,
        qualityStatus: quality.status,
        canonicalAudio: decoded.audio,
      });
    } catch {
      throw invalid();
    } finally {
      clearTimeout(timeout);
      input.signal?.removeEventListener('abort', abort);
      this.active -= 1;
    }
  }

  private async run(
    input: Readonly<{
      executable: string;
      args: readonly string[];
      stdin: Uint8Array;
      signal?: AbortSignal;
    }>,
  ): Promise<PronunciationAudioProcessResult> {
    const remaining = Math.max(
      1,
      input.signal?.aborted ? 0 : this.config.timeoutMs,
    );
    return this.runner.run({
      ...input,
      timeoutMs: Math.min(this.config.timeoutMs, remaining),
      maxOutputBytes: this.config.maxOutputBytes,
      maxMemoryBytes: this.config.maxMemoryBytes,
      shell: false,
      networkDisabled: true,
    });
  }
}
