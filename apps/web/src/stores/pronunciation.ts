import { computed, ref } from "vue";
import { defineStore } from "pinia";
import {
  pronunciationAssessmentResourceSchema,
  type PronunciationAssessmentResource,
} from "@en/common/pronunciation";

export type PronunciationUiState =
  | "idle"
  | "created"
  | "validating_audio"
  | "ready"
  | "queued"
  | "processing"
  | "completed"
  | "reference_only"
  | "unrecognizable"
  | "rejected"
  | "cancelled"
  | "timed_out"
  | "failed"
  | "deleting"
  | "deleted";

export type PronunciationStoreError = Readonly<{
  code: string;
  message: string;
  retryable: boolean;
  category?: PronunciationFailureCategory;
  retryAfterSeconds?: number | null;
}>;

export type PronunciationFailureCategory =
  | "BROWSER"
  | "DEVICE"
  | "TARGET"
  | "UPLOAD"
  | "AUDIO"
  | "QUEUE"
  | "GOVERNANCE"
  | "PROVIDER"
  | "LEARNING";

const FAILURE_PRESENTATIONS: Readonly<
  Record<
    string,
    Readonly<{
      category: PronunciationFailureCategory;
      message: string;
      retryable: boolean;
    }>
  >
> = Object.freeze({
  BROWSER_UNSUPPORTED: {
    category: "BROWSER",
    message: "当前浏览器不支持录音，请使用最新版 Chrome、Edge 或 Safari。",
    retryable: false,
  },
  MICROPHONE_PERMISSION_DENIED: {
    category: "DEVICE",
    message: "无法使用麦克风，请在浏览器设置中允许麦克风权限。",
    retryable: false,
  },
  UPLOAD_FAILED: {
    category: "UPLOAD",
    message: "录音上传失败，请检查网络后重试。",
    retryable: true,
  },
  STORAGE_NOT_APPROVED: {
    category: "UPLOAD",
    message: "录音上传当前不可用。",
    retryable: false,
  },
  AUDIO_LOW_VOLUME: {
    category: "AUDIO",
    message: "录音音量过低，请靠近麦克风重新录制。",
    retryable: true,
  },
  AUDIO_TOO_SHORT: {
    category: "AUDIO",
    message: "录音时间太短，请重新录制。",
    retryable: true,
  },
  AUDIO_TOO_LONG: {
    category: "AUDIO",
    message: "录音超过 30 秒，请缩短后重试。",
    retryable: true,
  },
  AUDIO_TOO_LARGE: {
    category: "UPLOAD",
    message: "录音超过 8 MiB，请缩短后重试。",
    retryable: true,
  },
  AUDIO_UNSUPPORTED: {
    category: "AUDIO",
    message: "当前录音格式不受支持，请重新录制。",
    retryable: true,
  },
  AUDIO_SILENT: {
    category: "AUDIO",
    message: "没有检测到清晰语音，请重新录制。",
    retryable: true,
  },
  AUDIO_INVALID: {
    category: "AUDIO",
    message: "无法安全读取录音，请重新录制。",
    retryable: true,
  },
  SPEECH_UNRECOGNIZABLE: {
    category: "AUDIO",
    message: "暂时无法识别这段语音，请重新录制。",
    retryable: true,
  },
  QUEUE_UNAVAILABLE: {
    category: "QUEUE",
    message: "评测排队暂时不可用，请稍后重试。",
    retryable: true,
  },
  RATE_LIMITED: {
    category: "GOVERNANCE",
    message: "请求过于频繁，请稍后重试。",
    retryable: true,
  },
  CONCURRENCY_LIMITED: {
    category: "GOVERNANCE",
    message: "已有评测正在处理中，请稍后重试。",
    retryable: true,
  },
  SOURCE_UNAVAILABLE: {
    category: "TARGET",
    message: "练习内容已不可用，请选择新的内容。",
    retryable: false,
  },
  FEATURE_DISABLED: {
    category: "GOVERNANCE",
    message: "发音评测功能当前不可用。",
    retryable: false,
  },
  BUDGET_EXCEEDED: {
    category: "GOVERNANCE",
    message: "评测额度已用完，请稍后再试。",
    retryable: true,
  },
  PROVIDER_TIMEOUT: {
    category: "PROVIDER",
    message: "评测服务响应超时，请稍后重试。",
    retryable: true,
  },
  PROVIDER_UNAVAILABLE: {
    category: "PROVIDER",
    message: "评测服务暂时不可用，请稍后重试。",
    retryable: true,
  },
  PROVIDER_NOT_APPROVED: {
    category: "PROVIDER",
    message: "发音评测服务当前不可用。",
    retryable: false,
  },
  REQUEST_TIMEOUT: {
    category: "GOVERNANCE",
    message: "评测处理超时，请重新发起。",
    retryable: true,
  },
  CANCELLED: {
    category: "GOVERNANCE",
    message: "评测已取消。",
    retryable: false,
  },
  LEARNING_WRITE_FAILED: {
    category: "LEARNING",
    message: "评测已完成，但学习进度暂未保存，请稍后重试保存。",
    retryable: true,
  },
  INTERNAL_ERROR: {
    category: "GOVERNANCE",
    message: "评测暂时不可用，请稍后重试。",
    retryable: true,
  },
});

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Converts untrusted transport failures to locally owned, non-sensitive copy. */
export function toPronunciationStoreError(
  untrusted: unknown,
): PronunciationStoreError {
  const outer = record(untrusted);
  const response = record(outer?.response);
  const envelope = record(response?.data) ?? outer;
  const detail = record(envelope?.error);
  const code =
    typeof detail?.code === "string" && FAILURE_PRESENTATIONS[detail.code]
      ? detail.code
      : "INTERNAL_ERROR";
  const presentation =
    FAILURE_PRESENTATIONS[code] ?? FAILURE_PRESENTATIONS.INTERNAL_ERROR!;
  const retryAfter = detail?.retryAfterSeconds;
  return Object.freeze({
    code,
    category: presentation.category,
    message: presentation.message,
    retryable:
      presentation.retryable &&
      (typeof detail?.retryable !== "boolean" || detail.retryable),
    retryAfterSeconds:
      Number.isSafeInteger(retryAfter) &&
      Number(retryAfter) >= 1 &&
      Number(retryAfter) <= 86_400
        ? Number(retryAfter)
        : null,
  });
}

const STATUS_TO_UI_STATE = Object.freeze({
  CREATED: "created",
  AUDIO_VALIDATING: "validating_audio",
  AUDIO_READY: "ready",
  QUEUED: "queued",
  PROCESSING: "processing",
  COMPLETED: "completed",
  REFERENCE_ONLY: "reference_only",
  UNRECOGNIZABLE: "unrecognizable",
  REJECTED: "rejected",
  CANCELLED: "cancelled",
  TIMED_OUT: "timed_out",
  FAILED: "failed",
  DELETING: "deleting",
  DELETED: "deleted",
} satisfies Record<
  PronunciationAssessmentResource["status"],
  Exclude<PronunciationUiState, "idle">
>);

export function pronunciationRolloutCapabilities(
  environment: Readonly<Record<string, unknown>>,
) {
  const enabled = (name: string) => environment[name] === "true";
  const recording = enabled("VITE_PRONUNCIATION_CAPTURE_ENABLED");
  const upload = recording && enabled("VITE_PRONUNCIATION_UPLOAD_ENABLED");
  const provider = upload && enabled("VITE_PRONUNCIATION_PROVIDER_ENABLED");
  const resultDisplay =
    provider && enabled("VITE_PRONUNCIATION_RESULT_DISPLAY_ENABLED");
  return Object.freeze({
    recording,
    upload,
    provider,
    resultDisplay,
    learningWrite:
      resultDisplay && enabled("VITE_PRONUNCIATION_LEARNING_WRITE_ENABLED"),
    coachSummary:
      resultDisplay && enabled("VITE_PRONUNCIATION_COACH_SUMMARY_ENABLED"),
  });
}

export const usePronunciationStore = defineStore("pronunciation", () => {
  const assessment = ref<PronunciationAssessmentResource | null>(null);
  const error = ref<PronunciationStoreError | null>(null);

  // These browser-only values deliberately remain outside Pinia state and
  // therefore outside pinia-plugin-persistedstate serialization.
  let recordingBlob: Blob | null = null;
  let recordingObjectUrl: string | null = null;
  let recordingDurationMs: number | null = null;

  const uiState = computed<PronunciationUiState>(() =>
    assessment.value ? STATUS_TO_UI_STATE[assessment.value.status] : "idle",
  );

  const learningDisclosure = computed(() => {
    switch (assessment.value?.learningWriteStatus) {
      case "SAVED":
        return "本次结果已用于更新学习进度。";
      case "PENDING":
        return "学习进度正在保存。";
      case "FAILED":
        return "评测结果已保留，但学习进度暂未保存。";
      case "COMPENSATING":
        return "正在撤销本次评测对学习进度的影响。";
      case "COMPENSATED":
        return "本次评测对学习进度的影响已撤销。";
      default:
        return "本次结果不会修改学习进度。";
    }
  });

  function acceptAssessment(untrusted: unknown): boolean {
    const parsed = pronunciationAssessmentResourceSchema.safeParse(untrusted);
    if (!parsed.success) {
      assessment.value = null;
      error.value = {
        code: "VALIDATION_FAILED",
        message: "评测结果格式无效，请安全重试。",
        retryable: true,
      };
      return false;
    }
    assessment.value = parsed.data;
    error.value = parsed.data.diagnostic
      ? {
          code: parsed.data.diagnostic.code,
          message: parsed.data.diagnostic.message,
          retryable: parsed.data.diagnostic.retryable,
        }
      : null;
    return true;
  }

  function setError(value: PronunciationStoreError | null): void {
    error.value = value ? Object.freeze({ ...value }) : null;
  }

  function setLocalRecording(
    blob: Blob,
    objectUrl: string,
    durationMs = 0,
  ): void {
    if (!(blob instanceof Blob) || !objectUrl.startsWith("blob:")) {
      throw new Error("INVALID_LOCAL_RECORDING");
    }
    recordingBlob = blob;
    recordingObjectUrl = objectUrl;
    recordingDurationMs = durationMs;
  }

  function getLocalRecording(): Readonly<{
    blob: Blob;
    objectUrl: string;
    durationMs: number;
  }> | null {
    return recordingBlob && recordingObjectUrl && recordingDurationMs !== null
      ? Object.freeze({
          blob: recordingBlob,
          objectUrl: recordingObjectUrl,
          durationMs: recordingDurationMs,
        })
      : null;
  }

  function clearLocalRecording(): void {
    recordingBlob = null;
    recordingObjectUrl = null;
    recordingDurationMs = null;
  }

  function reset(): void {
    assessment.value = null;
    error.value = null;
    clearLocalRecording();
  }

  return {
    assessment,
    error,
    uiState,
    learningDisclosure,
    acceptAssessment,
    setError,
    setLocalRecording,
    getLocalRecording,
    clearLocalRecording,
    reset,
  };
});
