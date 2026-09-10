<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import type {
  PronunciationAssessmentResource,
  PronunciationLocale,
  PronunciationPublicErrorCode,
  PronunciationTargetInput,
} from "@en/common/pronunciation";
import {
  cancelPronunciationAssessment,
  createPronunciationAssessment,
  getPronunciationAssessment,
  retryPronunciationAssessment,
  submitAndPollPronunciationAssessment,
  uploadPronunciationAudio,
} from "@/apis/pronunciation";
import type { LocalPronunciationRecording } from "@/hooks/usePronunciationRecorder";
import {
  toPronunciationStoreError,
  type PronunciationStoreError,
} from "@/stores/pronunciation";
import PronunciationAssessmentResult from "./PronunciationAssessmentResult.vue";
import PronunciationFailure from "./PronunciationFailure.vue";
import PronunciationRecorder from "./PronunciationRecorder.vue";

const TERMINAL_FALLBACK_CODES: Partial<
  Record<
    PronunciationAssessmentResource["status"],
    PronunciationPublicErrorCode
  >
> = {
  UNRECOGNIZABLE: "SPEECH_UNRECOGNIZABLE",
  REJECTED: "AUDIO_INVALID",
  CANCELLED: "CANCELLED",
  TIMED_OUT: "REQUEST_TIMEOUT",
  FAILED: "INTERNAL_ERROR",
};

const props = withDefaults(
  defineProps<{
    target: PronunciationTargetInput;
    enabled?: boolean;
    sourceRuntimeApproved?: boolean;
    locale?: PronunciationLocale;
    compact?: boolean;
  }>(),
  {
    enabled: false,
    sourceRuntimeApproved: false,
    locale: "en-US",
    compact: false,
  },
);

const emit = defineEmits<{
  created: [assessment: PronunciationAssessmentResource];
}>();

const pending = ref(false);
const errorMessage = ref("");
const assessment = ref<PronunciationAssessmentResource | null>(null);
const failure = ref<PronunciationStoreError | null>(null);
const recorder = ref<{ seek(milliseconds: number): Promise<void> } | null>(
  null,
);
const abortController = ref<AbortController | null>(null);
let uploadKey = "";
let submitKey = "";
let retryKey = "";
let cancelKey = "";
let lastRecording: LocalPronunciationRecording | null = null;
let failedStage: "upload" | "submit" | null = null;
let cancelledLocally = false;

const statusLabel = computed(() => {
  if (!assessment.value) return "";
  return {
    CREATED: "评测已创建，请录制发音。",
    AUDIO_VALIDATING: "正在安全检查录音…",
    AUDIO_READY: "录音已就绪。",
    QUEUED: "评测已排队…",
    PROCESSING: "AI 正在分析发音…",
    COMPLETED: "评测完成。",
    REFERENCE_ONLY: "评测完成，结果仅供参考。",
    UNRECOGNIZABLE: "未能识别这段发音。",
    REJECTED: "录音未通过安全或质量检查。",
    CANCELLED: "评测已取消。",
    TIMED_OUT: "评测处理超时。",
    FAILED: "评测未完成。",
    DELETING: "正在删除评测。",
    DELETED: "评测已删除。",
  }[assessment.value.status];
});

const sourceAllowed = computed(() => {
  if (
    props.target.sourceType === "MANUAL" ||
    props.target.sourceType === "WORD_BOOK" ||
    props.target.sourceType === "COACH_EXERCISE"
  ) {
    return true;
  }
  return props.sourceRuntimeApproved;
});

const visible = computed(() => props.enabled && sourceAllowed.value);

async function start(): Promise<void> {
  if (!visible.value || pending.value) return;
  pending.value = true;
  errorMessage.value = "";
  try {
    resetOperation();
    const idempotencyKey = operationKey("create");
    const response = await createPronunciationAssessment(
      { locale: props.locale, target: props.target },
      idempotencyKey,
    );
    assessment.value = response.data;
    emit("created", response.data);
  } catch {
    errorMessage.value = "暂时无法开始发音练习，请稍后重试。";
  } finally {
    pending.value = false;
  }
}

function operationKey(operation: string): string {
  return `pronunciation-${operation}-${crypto.randomUUID().replaceAll("-", "")}`;
}

function resetOperation(): void {
  abortController.value?.abort();
  abortController.value = new AbortController();
  uploadKey = operationKey("upload");
  submitKey = operationKey("submit");
  retryKey = operationKey("retry");
  cancelKey = operationKey("cancel");
  lastRecording = null;
  failedStage = null;
  cancelledLocally = false;
  failure.value = null;
  errorMessage.value = "";
}

function setTerminalFailure(resource: PronunciationAssessmentResource): void {
  if (resource.result) {
    failure.value = null;
    return;
  }
  const fallbackCode = TERMINAL_FALLBACK_CODES[resource.status];
  const code = resource.diagnostic?.code ?? fallbackCode;
  failure.value = code
    ? toPronunciationStoreError({
        error: {
          code,
          retryable: resource.diagnostic?.retryable,
        },
      })
    : null;
}

async function submit(): Promise<void> {
  if (!assessment.value) return;
  failedStage = "submit";
  const result = await submitAndPollPronunciationAssessment(
    assessment.value.assessmentId,
    submitKey,
    { signal: abortController.value?.signal },
  );
  assessment.value = result;
  failedStage = null;
  setTerminalFailure(result);
}

async function useRecording(
  recording: LocalPronunciationRecording,
): Promise<void> {
  if (!assessment.value || pending.value) return;
  lastRecording = recording;
  pending.value = true;
  failure.value = null;
  failedStage = "upload";
  try {
    const uploaded = await uploadPronunciationAudio(
      assessment.value.assessmentId,
      recording.blob,
      uploadKey,
      {
        durationMs: recording.durationMs,
        signal: abortController.value?.signal,
      },
    );
    assessment.value = uploaded.data;
    if (uploaded.data.status !== "AUDIO_READY") {
      failedStage = null;
      setTerminalFailure(uploaded.data);
      return;
    }
    await submit();
  } catch (error) {
    if (!cancelledLocally) failure.value = toPronunciationStoreError(error);
  } finally {
    pending.value = false;
  }
}

async function cancel(): Promise<void> {
  if (!assessment.value || !pending.value) return;
  cancelledLocally = true;
  abortController.value?.abort();
  try {
    const cancelled = await cancelPronunciationAssessment(
      assessment.value.assessmentId,
      cancelKey,
    );
    assessment.value = cancelled.data;
    setTerminalFailure(cancelled.data);
  } catch (error) {
    failure.value = toPronunciationStoreError(error);
  } finally {
    pending.value = false;
  }
}

async function retry(): Promise<void> {
  if (!assessment.value || pending.value) return;
  if (failedStage === "upload" && lastRecording) {
    await useRecording(lastRecording);
    return;
  }
  if (failedStage === "submit") {
    pending.value = true;
    failure.value = null;
    try {
      await submit();
    } catch (error) {
      failure.value = toPronunciationStoreError(error);
    } finally {
      pending.value = false;
    }
    return;
  }

  pending.value = true;
  try {
    const latest = await getPronunciationAssessment(
      assessment.value.assessmentId,
      abortController.value?.signal,
    );
    const retried = await retryPronunciationAssessment(
      latest.data.assessmentId,
      retryKey,
    );
    resetOperation();
    assessment.value = retried.data;
  } catch (error) {
    failure.value = toPronunciationStoreError(error);
  } finally {
    pending.value = false;
  }
}

function close(): void {
  abortController.value?.abort();
  abortController.value = null;
  assessment.value = null;
  failure.value = null;
  lastRecording = null;
  failedStage = null;
}

onBeforeUnmount(() => abortController.value?.abort());
</script>

<template>
  <div v-if="visible" class="pronunciation-entry" @click.stop>
    <button
      v-if="!assessment"
      type="button"
      class="pronunciation-entry__button"
      :class="{ 'pronunciation-entry__button--compact': compact }"
      :disabled="pending"
      @click="start"
    >
      {{ pending ? "正在准备…" : "练习发音" }}
    </button>
    <p v-if="errorMessage" class="pronunciation-entry__error" role="alert">
      {{ errorMessage }}
    </p>
    <section
      v-if="assessment"
      class="pronunciation-entry__flow"
      aria-label="发音评测流程"
    >
      <header class="pronunciation-entry__flow-header">
        <p role="status" aria-live="polite">{{ statusLabel }}</p>
        <button v-if="pending" type="button" @click="cancel">取消</button>
        <button v-else type="button" @click="close">关闭</button>
      </header>
      <PronunciationRecorder
        v-show="!assessment.result && !failure"
        ref="recorder"
        @ready="useRecording"
      />
      <p v-if="pending" class="pronunciation-entry__pending" role="status">
        正在处理，请稍候…
      </p>
      <PronunciationAssessmentResult
        v-if="assessment.result"
        :result="assessment.result"
        @seek="recorder?.seek($event)"
      />
      <PronunciationFailure v-if="failure" :error="failure" @retry="retry" />
    </section>
  </div>
</template>

<style scoped>
.pronunciation-entry {
  display: inline-flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.35rem;
}

.pronunciation-entry__button {
  min-height: 2.5rem;
  padding: 0.55rem 0.9rem;
  border: 1px solid #3559e0;
  border-radius: 0.65rem;
  background: #eef2ff;
  color: #2845ae;
  font-weight: 700;
  cursor: pointer;
}

.pronunciation-entry__button--compact {
  min-height: 2rem;
  padding: 0.35rem 0.65rem;
  font-size: 0.78rem;
}

.pronunciation-entry__button:disabled {
  cursor: wait;
  opacity: 0.65;
}

.pronunciation-entry__button:focus-visible {
  outline: 3px solid #3559e0;
  outline-offset: 2px;
}

.pronunciation-entry__error {
  margin: 0;
  color: #a52828;
  font-size: 0.78rem;
}

.pronunciation-entry__flow {
  display: grid;
  width: min(36rem, calc(100vw - 2rem));
  gap: 0.75rem;
  padding: 0.75rem;
  border: 1px solid #dce1ea;
  border-radius: 0.9rem;
  background: #fff;
  box-shadow: 0 0.75rem 2rem rgb(27 39 71 / 12%);
}

.pronunciation-entry__flow-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.pronunciation-entry__flow-header p,
.pronunciation-entry__pending {
  margin: 0;
  color: #566077;
  font-size: 0.85rem;
}
</style>
