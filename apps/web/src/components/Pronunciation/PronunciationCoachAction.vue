<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { createCoachConversation, createCoachRequest } from "@/apis/coach";

const props = withDefaults(
  defineProps<{
    assessmentId: string;
    enabled?: boolean;
  }>(),
  { enabled: false },
);

const router = useRouter();
const pending = ref(false);
const errorMessage = ref("");

function idempotencyKey(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().replaceAll("-", "")}`;
}

async function askCoach(): Promise<void> {
  if (!props.enabled || pending.value) return;
  pending.value = true;
  errorMessage.value = "";
  try {
    const conversation = await createCoachConversation(
      { title: "发音评测后续练习" },
      idempotencyKey("pronunciation-coach"),
    );
    const accepted = await createCoachRequest(
      conversation.data.id,
      { type: "RECOMMENDATION", assessmentId: props.assessmentId },
      idempotencyKey("pronunciation-recommendation"),
    );
    await router.push({
      name: "personalized-coach",
      query: {
        conversationId: conversation.data.id,
        requestId: accepted.data.requestId,
      },
    });
  } catch {
    errorMessage.value = "评测或来源暂不可用，请确认状态后重试。";
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <section v-if="enabled" class="pronunciation-coach-action">
    <div>
      <h3>让 Coach 安排下一步</h3>
      <p>
        将新建一条 Coach 活动，只发送本次评测编号；Coach
        不会读取录音，也不会重新评分或改写学习记录。
      </p>
    </div>
    <button type="button" :disabled="pending" @click="askCoach">
      {{ pending ? "正在创建…" : "获取 Coach 建议" }}
    </button>
    <p
      v-if="errorMessage"
      class="pronunciation-coach-action__error"
      role="alert"
    >
      {{ errorMessage }}
    </p>
  </section>
</template>

<style scoped>
.pronunciation-coach-action {
  display: grid;
  gap: 0.75rem;
  padding: 1rem;
  border: 1px solid #c9d4f5;
  border-radius: 0.85rem;
  background: #f5f7ff;
}

.pronunciation-coach-action h3,
.pronunciation-coach-action p {
  margin: 0;
}

.pronunciation-coach-action p {
  margin-top: 0.35rem;
  color: #566077;
  font-size: 0.85rem;
  line-height: 1.5;
}

.pronunciation-coach-action button {
  justify-self: start;
  min-height: 2.5rem;
  padding: 0.55rem 0.9rem;
  border: 1px solid #3559e0;
  border-radius: 0.65rem;
  background: #3559e0;
  color: #fff;
  font-weight: 700;
  cursor: pointer;
}

.pronunciation-coach-action button:disabled {
  cursor: wait;
  opacity: 0.65;
}

.pronunciation-coach-action button:focus-visible {
  outline: 3px solid #90a4ff;
  outline-offset: 2px;
}

.pronunciation-coach-action .pronunciation-coach-action__error {
  color: #a52828;
}
</style>
