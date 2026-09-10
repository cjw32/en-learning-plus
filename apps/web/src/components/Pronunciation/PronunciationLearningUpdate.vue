<script setup lang="ts">
import { computed } from "vue";
import type { PronunciationLearningUpdate } from "@en/common/pronunciation";

const props = defineProps<{
  update: PronunciationLearningUpdate;
}>();

const statusText = computed(() => {
  if (props.update.message) return props.update.message;
  return {
    PROPOSED: "学习进度尚未写入，这是按当前规则计算的预览。",
    SAVED: "学习进度已更新。",
    NOT_ELIGIBLE: "本次结果不会修改学习进度。",
    FAILED: "评测结果已保留，但学习进度暂未保存。",
    COMPENSATED: "本次评测对学习进度的影响已撤销。",
  }[props.update.status];
});

function dateLabel(value: string | null): string {
  return value
    ? new Intl.DateTimeFormat("zh-CN", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "暂无复习日期";
}
</script>

<template>
  <section
    class="pronunciation-learning-update"
    aria-labelledby="pronunciation-learning-title"
  >
    <h3 id="pronunciation-learning-title">学习进度</h3>
    <p role="status">{{ statusText }}</p>
    <ul v-if="update.changedItems.length">
      <li
        v-for="change in update.changedItems"
        :key="`${change.targetPosition}:${change.word}`"
      >
        <strong>{{ change.word }}</strong>
        <span>
          {{ change.previousReviewState }} → {{ change.nextReviewState }}
        </span>
        <time v-if="change.nextReviewAt" :datetime="change.nextReviewAt">
          下次复习：{{ dateLabel(change.nextReviewAt) }}
        </time>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.pronunciation-learning-update {
  display: grid;
  gap: 0.6rem;
  padding: 0.75rem;
  border-radius: 0.75rem;
  background: #f3f5fa;
}

.pronunciation-learning-update h3,
.pronunciation-learning-update p,
.pronunciation-learning-update ul {
  margin: 0;
}

.pronunciation-learning-update ul {
  display: grid;
  gap: 0.5rem;
  padding-inline-start: 1.2rem;
}

.pronunciation-learning-update li span,
.pronunciation-learning-update li time {
  display: block;
  color: #566077;
  font-size: 0.85rem;
}
</style>
