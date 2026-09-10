<script setup lang="ts">
import { computed } from "vue";
import type { PronunciationResult } from "@en/common/pronunciation";
import PronunciationLearningUpdate from "./PronunciationLearningUpdate.vue";
import PronunciationCoachAction from "./PronunciationCoachAction.vue";
import PronunciationWordFeedback from "./PronunciationWordFeedback.vue";
import { pronunciationRolloutCapabilities } from "@/stores/pronunciation";

const props = defineProps<{
  result: PronunciationResult;
}>();

const emit = defineEmits<{
  seek: [milliseconds: number];
}>();

const scoreDimensions = computed(() => [
  { label: "准确度", value: props.result.scores.accuracy },
  { label: "完整度", value: props.result.scores.completeness },
  { label: "流利度", value: props.result.scores.fluency },
]);

const confidenceLabel = computed(() =>
  props.result.confidenceTier === "RELIABLE"
    ? "结果可靠"
    : "结果仅供参考，不会据此更新学习进度",
);

const coachSummaryEnabled = pronunciationRolloutCapabilities(
  import.meta.env,
).coachSummary;
</script>

<template>
  <section
    class="pronunciation-result"
    aria-labelledby="pronunciation-result-title"
  >
    <header class="pronunciation-result__header">
      <div>
        <p class="pronunciation-result__eyebrow">发音评测结果</p>
        <h2 id="pronunciation-result-title">
          {{ Math.round(result.scores.overall) }} 分
        </h2>
      </div>
      <div
        class="pronunciation-result__meter"
        role="progressbar"
        aria-label="发音综合评分"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-valuenow="Math.round(result.scores.overall)"
      >
        <span :style="{ width: `${result.scores.overall}%` }" />
      </div>
    </header>

    <p class="pronunciation-result__confidence" role="status">
      {{ confidenceLabel }}（置信度 {{ Math.round(result.confidence * 100) }}%）
    </p>

    <dl class="pronunciation-result__scores">
      <div v-for="dimension in scoreDimensions" :key="dimension.label">
        <dt>{{ dimension.label }}</dt>
        <dd>{{ Math.round(dimension.value) }} 分</dd>
      </div>
      <div>
        <dt>韵律</dt>
        <dd v-if="result.scores.prosody !== null">
          {{ Math.round(result.scores.prosody) }} 分
        </dd>
        <dd v-else>韵律评分暂不可用</dd>
      </div>
    </dl>

    <div class="pronunciation-result__text-comparison">
      <div>
        <h3>参考文本</h3>
        <p>{{ result.referenceText }}</p>
      </div>
      <div>
        <h3>识别文本</h3>
        <p>{{ result.recognizedText || "未识别到可展示文本" }}</p>
      </div>
    </div>

    <div aria-labelledby="pronunciation-word-feedback-title">
      <h3 id="pronunciation-word-feedback-title">逐词反馈</h3>
      <div class="pronunciation-result__words">
        <PronunciationWordFeedback
          v-for="word in result.words"
          :key="word.sequence"
          :word="word"
          @seek="emit('seek', $event)"
        />
      </div>
    </div>

    <div class="pronunciation-result__guidance">
      <h3>练习建议</h3>
      <p>{{ result.summary }}</p>
      <ul v-if="result.suggestions.length">
        <li v-for="suggestion in result.suggestions" :key="suggestion">
          {{ suggestion }}
        </li>
      </ul>
    </div>

    <PronunciationLearningUpdate :update="result.learningUpdate" />
    <PronunciationCoachAction
      v-if="coachSummaryEnabled"
      :assessment-id="result.assessmentId"
      enabled
    />
  </section>
</template>

<style scoped>
.pronunciation-result {
  display: grid;
  gap: 1.25rem;
  padding: 1.25rem;
  border: 1px solid #e1e5ec;
  border-radius: 1rem;
  background: #fff;
  color: #20283a;
}

.pronunciation-result__header {
  display: grid;
  gap: 0.75rem;
}

.pronunciation-result__eyebrow {
  margin: 0;
  color: #566077;
  font-size: 0.8rem;
  font-weight: 700;
}

.pronunciation-result__header h2 {
  margin: 0.2rem 0 0;
  font-size: 2rem;
}

.pronunciation-result__meter {
  overflow: hidden;
  height: 0.75rem;
  border-radius: 999px;
  background: #e8ebf1;
}

.pronunciation-result__meter span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: #3559e0;
}

.pronunciation-result__confidence {
  margin: 0;
  padding: 0.75rem;
  border-radius: 0.75rem;
  background: #f3f5fa;
}

.pronunciation-result__scores,
.pronunciation-result__text-comparison {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
  gap: 0.75rem;
  margin: 0;
}

.pronunciation-result__scores > div,
.pronunciation-result__text-comparison > div {
  padding: 0.8rem;
  border-radius: 0.75rem;
  background: #f7f8fb;
}

.pronunciation-result__scores dt,
.pronunciation-result__text-comparison h3,
.pronunciation-result__guidance h3,
#pronunciation-word-feedback-title {
  margin: 0;
  font-size: 0.85rem;
  color: #566077;
}

.pronunciation-result__scores dd,
.pronunciation-result__text-comparison p,
.pronunciation-result__guidance p {
  margin: 0.3rem 0 0;
}

.pronunciation-result__scores dd {
  font-weight: 700;
}

.pronunciation-result__words {
  display: flex;
  flex-wrap: wrap;
  gap: 0.65rem;
  margin-top: 0.65rem;
}

.pronunciation-result__guidance ul {
  margin: 0.55rem 0 0;
  padding-inline-start: 1.2rem;
}
</style>
