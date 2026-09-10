import { nextTick } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  detectPronunciationRecorderCapabilities,
  type PronunciationRecorderEnvironment,
} from '../pronunciation-recorder-capabilities';
import { usePronunciationRecorder } from '../usePronunciationRecorder';

class FakeTrack extends EventTarget {
  stop = vi.fn();
}

class FakeMediaRecorder extends EventTarget {
  static isTypeSupported = vi.fn((type: string) => type.includes('webm'));
  state: RecordingState = 'inactive';
  mimeType: string;
  start = vi.fn(() => {
    this.state = 'recording';
  });
  stop = vi.fn(() => {
    this.state = 'inactive';
    this.dispatchEvent(new Event('stop'));
  });

  constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
    super();
    this.mimeType = options?.mimeType ?? '';
  }
}

function environment(
  overrides: Partial<PronunciationRecorderEnvironment> = {},
) {
  return {
    secureContext: true,
    getUserMedia: vi.fn(),
    MediaRecorder: FakeMediaRecorder as unknown as typeof MediaRecorder,
    AudioContext: vi.fn(),
    ...overrides,
  };
}

function audioContextConstructor(instance: {
  close: ReturnType<typeof vi.fn>;
}): typeof AudioContext {
  return class {
    state = 'running';
    close = instance.close;
  } as unknown as typeof AudioContext;
}

describe('pronunciation recorder capabilities', () => {
  it('prefers WebM/Opus, falls back to MP4/AAC, and never uses User-Agent', () => {
    const env = environment();
    expect(detectPronunciationRecorderCapabilities(env)).toMatchObject({
      supported: true,
      mimeType: 'audio/webm;codecs=opus',
    });
    FakeMediaRecorder.isTypeSupported.mockImplementation((type) =>
      type.includes('mp4'),
    );
    expect(detectPronunciationRecorderCapabilities(env)).toMatchObject({
      supported: true,
      mimeType: 'audio/mp4;codecs=mp4a.40.2',
    });
    expect(
      FakeMediaRecorder.isTypeSupported.mock.calls.flat().join(' '),
    ).not.toMatch(/user.?agent/i);
  });

  it.each([
    [{ secureContext: false }, 'INSECURE_CONTEXT'],
    [{ getUserMedia: undefined }, 'GET_USER_MEDIA_UNAVAILABLE'],
    [{ MediaRecorder: undefined }, 'MEDIA_RECORDER_UNAVAILABLE'],
  ])('reports unsupported runtime %s', (override, reason) => {
    expect(
      detectPronunciationRecorderCapabilities(environment(override as never)),
    ).toEqual({ supported: false, reason });
  });
});

describe('usePronunciationRecorder', () => {
  let track: FakeTrack;
  let stream: MediaStream;
  let audioContext: { close: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.useFakeTimers();
    FakeMediaRecorder.isTypeSupported.mockImplementation((type) =>
      type.includes('webm'),
    );
    track = new FakeTrack();
    stream = {
      getTracks: () => [track],
      getAudioTracks: () => [track],
    } as unknown as MediaStream;
    audioContext = { close: vi.fn().mockResolvedValue(undefined) };
  });

  afterEach(() => vi.useRealTimers());

  it('requests permission only from explicit start and records continuously without pause', async () => {
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    const recorder = usePronunciationRecorder({
      environment: environment({
        getUserMedia,
        AudioContext: audioContextConstructor(audioContext),
      }),
    });
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(recorder).not.toHaveProperty('pause');
    await recorder.start();
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(recorder.state.value).toBe('recording');
  });

  it('maps denied/no-device errors to distinct recoverable states', async () => {
    for (const [name, state] of [
      ['NotAllowedError', 'permission_denied'],
      ['NotFoundError', 'no_device'],
    ] as const) {
      const error = new DOMException('blocked', name);
      const recorder = usePronunciationRecorder({
        environment: environment({
          getUserMedia: vi.fn().mockRejectedValue(error),
        }),
      });
      await expect(recorder.start()).resolves.toBeUndefined();
      expect(recorder.state.value).toBe(state);
    }
  });

  it('handles device interruption and releases tracks, context, timers and object URL', async () => {
    const revokeObjectURL = vi.fn();
    const recorder = usePronunciationRecorder({
      environment: environment({
        getUserMedia: vi.fn().mockResolvedValue(stream),
        AudioContext: audioContextConstructor(audioContext),
      }),
      createObjectURL: vi.fn(() => 'blob:recording'),
      revokeObjectURL,
    });
    await recorder.start();
    track.dispatchEvent(new Event('ended'));
    await nextTick();
    expect(recorder.state.value).toBe('interrupted');
    await recorder.dispose();
    expect(track.stop).toHaveBeenCalled();
    expect(audioContext.close).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:recording');
  });

  it('supports stop, delete and re-record while replacing the previous preview URL', async () => {
    const instances: FakeMediaRecorder[] = [];
    class Recorder extends FakeMediaRecorder {
      constructor(value: MediaStream, options?: MediaRecorderOptions) {
        super(value, options);
        instances.push(this);
      }
    }
    (Recorder as typeof FakeMediaRecorder).isTypeSupported =
      FakeMediaRecorder.isTypeSupported;
    const revokeObjectURL = vi.fn();
    const recorder = usePronunciationRecorder({
      environment: environment({
        getUserMedia: vi.fn().mockResolvedValue(stream),
        MediaRecorder: Recorder as unknown as typeof MediaRecorder,
        AudioContext: audioContextConstructor(audioContext),
      }),
      createObjectURL: vi.fn(() => 'blob:recording'),
      revokeObjectURL,
    });
    await recorder.start();
    instances[0]!.dispatchEvent(
      Object.assign(new Event('dataavailable'), { data: new Blob(['voice']) }),
    );
    await recorder.stop();
    expect(recorder.state.value).toBe('preview');
    expect(recorder.recording.value?.objectUrl).toBe('blob:recording');
    recorder.deleteRecording();
    expect(recorder.state.value).toBe('idle');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:recording');
    await recorder.start();
    expect(recorder.state.value).toBe('recording');
  });
});
