<script setup lang="ts">
import { computed } from "vue";
import type { PronunciationStoreError } from "@/stores/pronunciation";

const props = defineProps<{ error: PronunciationStoreError }>();
defineEmits<{ retry: [] }>();

const retryHint = computed(() =>
  props.error.retryAfterSeconds
    ? `建议等待 ${props.error.retryAfterSeconds} 秒后重试。`
    : null,
);
</script>

<template>
  <section class="pronunciation-failure" role="alert" aria-live="polite">
    <h3>本次评测未完成</h3>
    <p>{{ error.message }}</p>
    <p v-if="retryHint" class="pronunciation-failure__hint">
      {{ retryHint }}
    </p>
    <button v-if="error.retryable" type="button" @click="$emit('retry')">
      重新尝试
    </button>
  </section>
</template>

<style scoped>
.pronunciation-failure {
  display: grid;
  gap: 0.75rem;
  padding: 1rem;
  border: 1px solid var(--el-color-danger-light-5);
  border-radius: 0.75rem;
}

.pronunciation-failure h3,
.pronunciation-failure p {
  margin: 0;
}

.pronunciation-failure__hint {
  color: var(--el-text-color-secondary);
}

.pronunciation-failure button {
  justify-self: start;
}
</style>
