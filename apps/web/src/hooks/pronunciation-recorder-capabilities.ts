export const PRONUNCIATION_RECORDER_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/mp4;codecs=mp4a.40.2",
] as const;

export type PronunciationRecorderEnvironment = Readonly<{
  secureContext: boolean;
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  MediaRecorder?: typeof MediaRecorder;
  AudioContext?: typeof AudioContext;
}>;

export type PronunciationRecorderCapabilities =
  | Readonly<{
      supported: true;
      mimeType: (typeof PRONUNCIATION_RECORDER_MIME_TYPES)[number];
    }>
  | Readonly<{
      supported: false;
      reason:
        | "INSECURE_CONTEXT"
        | "GET_USER_MEDIA_UNAVAILABLE"
        | "MEDIA_RECORDER_UNAVAILABLE"
        | "CODEC_UNAVAILABLE";
    }>;

export function browserPronunciationRecorderEnvironment(): PronunciationRecorderEnvironment {
  return Object.freeze({
    secureContext: globalThis.isSecureContext === true,
    getUserMedia: globalThis.navigator?.mediaDevices?.getUserMedia?.bind(
      globalThis.navigator.mediaDevices,
    ),
    MediaRecorder: globalThis.MediaRecorder,
    AudioContext: globalThis.AudioContext,
  });
}

export function detectPronunciationRecorderCapabilities(
  environment: PronunciationRecorderEnvironment,
): PronunciationRecorderCapabilities {
  if (!environment.secureContext) {
    return { supported: false, reason: "INSECURE_CONTEXT" };
  }
  if (typeof environment.getUserMedia !== "function") {
    return { supported: false, reason: "GET_USER_MEDIA_UNAVAILABLE" };
  }
  if (!environment.MediaRecorder) {
    return { supported: false, reason: "MEDIA_RECORDER_UNAVAILABLE" };
  }
  const mimeType = PRONUNCIATION_RECORDER_MIME_TYPES.find((candidate) => {
    try {
      return environment.MediaRecorder!.isTypeSupported(candidate);
    } catch {
      return false;
    }
  });
  return mimeType
    ? { supported: true, mimeType }
    : { supported: false, reason: "CODEC_UNAVAILABLE" };
}
