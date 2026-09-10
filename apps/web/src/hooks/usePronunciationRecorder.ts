import { computed, getCurrentScope, onScopeDispose, ref } from "vue";
import {
  browserPronunciationRecorderEnvironment,
  detectPronunciationRecorderCapabilities,
  type PronunciationRecorderEnvironment,
} from "./pronunciation-recorder-capabilities";

export type PronunciationRecorderState =
  | "idle"
  | "requesting_permission"
  | "recording"
  | "preview"
  | "permission_denied"
  | "no_device"
  | "interrupted"
  | "unsupported"
  | "error";

export type LocalPronunciationRecording = Readonly<{
  blob: Blob;
  objectUrl: string;
  mimeType: string;
  durationMs: number;
}>;

export type UsePronunciationRecorderOptions = Readonly<{
  environment?: PronunciationRecorderEnvironment;
  createObjectURL?: (blob: Blob) => string;
  revokeObjectURL?: (url: string) => void;
  now?: () => number;
}>;

export function usePronunciationRecorder(
  options: UsePronunciationRecorderOptions = {},
) {
  const environment =
    options.environment ?? browserPronunciationRecorderEnvironment();
  const createObjectURL = options.createObjectURL ?? URL.createObjectURL;
  const revokeObjectURL = options.revokeObjectURL ?? URL.revokeObjectURL;
  const now = options.now ?? Date.now;
  const capabilities = detectPronunciationRecorderCapabilities(environment);
  const state = ref<PronunciationRecorderState>(
    capabilities.supported ? "idle" : "unsupported",
  );
  const elapsedMs = ref(0);
  const level = ref(0);
  const recording = ref<LocalPronunciationRecording | null>(null);
  const canStart = computed(() =>
    ["idle", "permission_denied", "no_device", "interrupted", "error"].includes(
      state.value,
    ),
  );

  let stream: MediaStream | null = null;
  let mediaRecorder: MediaRecorder | null = null;
  let audioContext: AudioContext | null = null;
  let meterTimer: ReturnType<typeof setInterval> | null = null;
  let startedAt = 0;
  let chunks: Blob[] = [];
  let terminalAfterStop: PronunciationRecorderState | null = null;
  let discardAfterStop = false;

  function clearTimer(): void {
    if (meterTimer !== null) clearInterval(meterTimer);
    meterTimer = null;
  }

  async function releaseRuntime(): Promise<void> {
    clearTimer();
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    if (audioContext && audioContext.state !== "closed") {
      await audioContext.close();
    }
    audioContext = null;
    mediaRecorder = null;
    level.value = 0;
  }

  function revokePreview(): void {
    if (recording.value) revokeObjectURL(recording.value.objectUrl);
    recording.value = null;
  }

  function startMeter(currentStream: MediaStream): void {
    let analyser: AnalyserNode | null = null;
    let samples: Uint8Array<ArrayBuffer> | null = null;
    try {
      if (environment.AudioContext) {
        audioContext = new environment.AudioContext();
        if (
          audioContext.createMediaStreamSource &&
          audioContext.createAnalyser
        ) {
          analyser = audioContext.createAnalyser();
          analyser.fftSize = 256;
          audioContext.createMediaStreamSource(currentStream).connect(analyser);
          samples = new Uint8Array(analyser.frequencyBinCount);
        }
      }
    } catch {
      analyser = null;
      samples = null;
    }
    meterTimer = setInterval(() => {
      elapsedMs.value = Math.max(0, now() - startedAt);
      if (analyser && samples) {
        analyser.getByteTimeDomainData(samples);
        const energy = samples.reduce((sum, sample) => {
          const centered = (sample - 128) / 128;
          return sum + centered * centered;
        }, 0);
        level.value = Math.min(1, Math.sqrt(energy / samples.length));
      }
    }, 100);
  }

  async function finishInterrupted(): Promise<void> {
    if (state.value !== "recording") return;
    terminalAfterStop = "interrupted";
    state.value = "interrupted";
    const currentRecorder = mediaRecorder;
    if (currentRecorder && currentRecorder.state !== "inactive") {
      currentRecorder.stop();
    } else {
      await releaseRuntime();
    }
  }

  async function start(): Promise<void> {
    if (!canStart.value || !capabilities.supported) return;
    revokePreview();
    elapsedMs.value = 0;
    chunks = [];
    terminalAfterStop = null;
    discardAfterStop = false;
    state.value = "requesting_permission";
    try {
      stream = await environment.getUserMedia!({ audio: true });
      for (const track of stream.getAudioTracks()) {
        track.addEventListener("ended", () => void finishInterrupted(), {
          once: true,
        });
      }
      mediaRecorder = new environment.MediaRecorder!(stream, {
        mimeType: capabilities.mimeType,
      });
      mediaRecorder.addEventListener("dataavailable", (event) => {
        const data = (event as BlobEvent).data;
        if (data instanceof Blob) chunks.push(data);
      });
      mediaRecorder.addEventListener(
        "stop",
        () => {
          const finalState = terminalAfterStop;
          if (!discardAfterStop) {
            const blob = new Blob(chunks, { type: capabilities.mimeType });
            const objectUrl = createObjectURL(blob);
            recording.value = Object.freeze({
              blob,
              objectUrl,
              mimeType: capabilities.mimeType,
              durationMs: Math.max(0, now() - startedAt),
            });
          }
          void releaseRuntime().then(() => {
            state.value = finalState ?? (discardAfterStop ? "idle" : "preview");
          });
        },
        { once: true },
      );
      startedAt = now();
      mediaRecorder.start(250);
      startMeter(stream);
      state.value = "recording";
    } catch (error) {
      await releaseRuntime();
      state.value =
        error instanceof DOMException && error.name === "NotAllowedError"
          ? "permission_denied"
          : error instanceof DOMException && error.name === "NotFoundError"
            ? "no_device"
            : "error";
    }
  }

  async function stop(): Promise<void> {
    if (state.value !== "recording" || !mediaRecorder) return;
    const stopped = new Promise<void>((resolve) =>
      mediaRecorder!.addEventListener("stop", () => resolve(), { once: true }),
    );
    mediaRecorder.stop();
    await stopped;
    await releaseRuntime();
    state.value = recording.value ? "preview" : "error";
  }

  function deleteRecording(): void {
    revokePreview();
    if (
      state.value !== "recording" &&
      state.value !== "requesting_permission"
    ) {
      elapsedMs.value = 0;
      state.value = capabilities.supported ? "idle" : "unsupported";
    }
  }

  async function dispose(): Promise<void> {
    discardAfterStop = true;
    const currentRecorder = mediaRecorder;
    if (currentRecorder && currentRecorder.state !== "inactive") {
      currentRecorder.stop();
    }
    await releaseRuntime();
    revokePreview();
    elapsedMs.value = 0;
    state.value = capabilities.supported ? "idle" : "unsupported";
  }

  if (getCurrentScope()) onScopeDispose(() => void dispose());

  return {
    state,
    elapsedMs,
    level,
    recording,
    canStart,
    start,
    stop,
    deleteRecording,
    dispose,
  };
}
