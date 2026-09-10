<script setup lang="ts">
import { computed } from "vue";
import type { PronunciationWordAssessment } from "@en/common/pronunciation";

const props = defineProps<{
  word: PronunciationWordAssessment;
}>();

const emit = defineEmits<{
  seek: [milliseconds: number];
}>();

const statusLabel = computed(
  () =>
    ({
      correct: "正确",
      mispronounced: "误读",
      omitted: "漏读",
      inserted: "多读",
      uncertain: "不确定",
    })[props.word.status],
);

const seekable = computed(
  () =>
    props.word.startMs !== null &&
    props.word.endMs !== null &&
    props.word.endMs >= props.word.startMs,
);

const accessibleLabel = computed(() => {
  const score = props.word.score === null ? "未评分" : `${props.word.score} 分`;
  const action = seekable.value ? "，按回车播放此处录音" : "，无可用录音位置";
  return `${props.word.word}，${statusLabel.value}，${score}${action}`;
});

function seek(): void {
  if (seekable.value && props.word.startMs !== null) {
    emit("seek", props.word.startMs);
  }
}
</script>

<template>
  <button
    class="pronunciation-word"
    :class="`pronunciation-word--${word.status}`"
    type="button"
    :data-word-sequence="word.sequence"
    :aria-label="accessibleLabel"
    :aria-disabled="seekable ? 'false' : 'true'"
    :tabindex="seekable ? 0 : -1"
    @click="seek"
    @keydown.enter.prevent="seek"
    @keydown.space.prevent="seek"
  >
    <span class="pronunciation-word__text">{{ word.word }}</span>
    <span class="pronunciation-word__status">{{ statusLabel }}</span>
    <span v-if="word.score !== null" class="pronunciation-word__score">
      {{ Math.round(word.score) }} 分
    </span>
    <span v-if="word.feedback" class="pronunciation-word__feedback">
      {{ word.feedback }}
    </span>
  </button>
</template>

<style scoped>
.pronunciation-word {
  display: inline-flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.2rem;
  min-width: 5.5rem;
  padding: 0.65rem 0.75rem;
  border: 1px solid #d7dce5;
  border-radius: 0.75rem;
  background: #fff;
  color: #253047;
  text-align: left;
}

.pronunciation-word[aria-disabled="false"] {
  cursor: pointer;
}

.pronunciation-word:focus-visible {
  outline: 3px solid #3559e0;
  outline-offset: 2px;
}

.pronunciation-word--correct {
  border-inline-start: 0.35rem solid #18864b;
}

.pronunciation-word--mispronounced,
.pronunciation-word--omitted {
  border-inline-start: 0.35rem solid #c43e35;
}

.pronunciation-word--inserted,
.pronunciation-word--uncertain {
  border-inline-start: 0.35rem solid #a46100;
}

.pronunciation-word__text {
  font-weight: 700;
}

.pronunciation-word__status,
.pronunciation-word__score,
.pronunciation-word__feedback {
  font-size: 0.78rem;
}

.pronunciation-word__feedback {
  max-width: 15rem;
  color: #4c566a;
}
</style>
