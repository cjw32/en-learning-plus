<script setup lang="ts">
import { computed, ref } from "vue";
import { onBeforeRouteLeave } from "vue-router";
import {
  usePronunciationRecorder,
  type LocalPronunciationRecording,
} from "@/hooks/usePronunciationRecorder";

const props = defineProps<{ disabled?: boolean; committed?: boolean }>();

const emit = defineEmits<{
  ready: [recording: LocalPronunciationRecording];
}>();

const recorder = usePronunciationRecorder();
const previewAudio = ref<HTMLAudioElement | null>(null);

const stateLabel = computed(
  () =>
    ({
      idle: "准备录音",
      requesting_permission: "正在请求麦克风权限",
      recording: "正在录音",
      preview: "录音已完成，可先试听",
      permission_denied: "未获得麦克风权限，请在浏览器设置中允许后重试",
      no_device: "未检测到麦克风，请连接设备后重试",
      interrupted: "录音已中断，请重新录制",
      unsupported: "当前浏览器不支持录音，请更换受支持的浏览器",
      error: "录音失败，请重新尝试",
    })[recorder.state.value],
);

const elapsedLabel = computed(() => {
  const seconds = Math.floor(recorder.elapsedMs.value / 1_000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
});

function hasUnsavedAudio(): boolean {
  if (props.committed) return false;
  return (
    recorder.state.value === "requesting_permission" ||
    recorder.state.value === "recording" ||
    recorder.state.value === "preview"
  );
}

async function rerecord(): Promise<void> {
  recorder.deleteRecording();
  await recorder.start();
}

function useRecording(): void {
  if (recorder.recording.value) emit("ready", recorder.recording.value);
}

async function seek(milliseconds: number): Promise<void> {
  const audio = previewAudio.value;
  if (!audio || !Number.isFinite(milliseconds) || milliseconds < 0) return;
  audio.currentTime = milliseconds / 1_000;
  await audio.play().catch(() => undefined);
}

defineExpose({ seek });

onBeforeRouteLeave(() => {
  if (!hasUnsavedAudio()) return true;
  return window.confirm("离开将丢弃当前录音，确定继续吗？");
});
</script>

<template>
  <fieldset :disabled="disabled" style="border: 0; padding: 0; margin: 0">
  <section
    class="pronunciation-recorder"
    aria-labelledby="pronunciation-recorder-title"
  >
    <div>
      <h2 id="pronunciation-recorder-title">录制你的发音</h2>
      <p class="pronunciation-recorder__disclosure">
        我们需要使用麦克风录制这一次发音；仅在你点击开始后请求权限。提交前可在本地试听、删除或重录。
      </p>
    </div>

    <p class="pronunciation-recorder__status" role="status" aria-live="polite">
      {{ stateLabel }}
    </p>

    <div
      v-if="recorder.state.value === 'recording'"
      class="pronunciation-recorder__live"
    >
      <time :datetime="`PT${Math.floor(recorder.elapsedMs.value / 1000)}S`">
        {{ elapsedLabel }}
      </time>
      <div
        class="pronunciation-recorder__level"
        role="meter"
        aria-label="麦克风音量"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-valuenow="Math.round(recorder.level.value * 100)"
      >
        <span
          :style="{ width: `${Math.round(recorder.level.value * 100)}%` }"
        />
      </div>
    </div>

    <audio
      v-if="recorder.recording.value"
      ref="previewAudio"
      controls
      preload="metadata"
      :src="recorder.recording.value.objectUrl"
    >
      当前浏览器无法播放本地录音。
    </audio>

    <div class="pronunciation-recorder__actions">
      <button
        v-if="recorder.canStart.value"
        data-test="recorder-start"
        type="button"
        @click="recorder.start"
      >
        开始录音
      </button>
      <button
        v-if="recorder.state.value === 'recording'"
        data-test="recorder-stop"
        type="button"
        @click="recorder.stop"
      >
        完成录音
      </button>
      <template v-if="recorder.state.value === 'preview'">
        <button
          data-test="recorder-delete"
          type="button"
          @click="recorder.deleteRecording"
        >
          删除录音
        </button>
        <button data-test="recorder-rerecord" type="button" @click="rerecord">
          重新录制
        </button>
        <button
          type="button"
          class="pronunciation-recorder__primary"
          @click="useRecording"
        >
          使用这段录音
        </button>
      </template>
    </div>
  </section>
  </fieldset>
</template>

<style scoped>
.pronunciation-recorder {
  display: grid;
  gap: 1rem;
  padding: 1.25rem;
  border: 1px solid #dce1ea;
  border-radius: 1rem;
  background: #fff;
  color: #20283a;
}

.pronunciation-recorder h2,
.pronunciation-recorder p {
  margin: 0;
}

.pronunciation-recorder__disclosure {
  margin-top: 0.4rem !important;
  color: #566077;
  font-size: 0.88rem;
}

.pronunciation-recorder__status {
  padding: 0.7rem;
  border-radius: 0.7rem;
  background: #f3f5fa;
  font-weight: 700;
}

.pronunciation-recorder__live {
  display: grid;
  gap: 0.5rem;
}

.pronunciation-recorder__level {
  overflow: hidden;
  height: 0.75rem;
  border-radius: 999px;
  background: #e4e8ef;
}

.pronunciation-recorder__level span {
  display: block;
  height: 100%;
  background: #3559e0;
}

.pronunciation-recorder__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.65rem;
}

.pronunciation-recorder button {
  min-height: 2.5rem;
  padding: 0.55rem 0.9rem;
  border: 1px solid #aeb7c7;
  border-radius: 0.65rem;
  background: #fff;
  color: #253047;
  font-weight: 700;
}

.pronunciation-recorder button:focus-visible {
  outline: 3px solid #3559e0;
  outline-offset: 2px;
}

.pronunciation-recorder__primary {
  border-color: #3559e0 !important;
  background: #3559e0 !important;
  color: #fff !important;
}
</style>
