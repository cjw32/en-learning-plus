<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue";
import type { CoachFeedbackInput } from "@/apis/coach";
import { upsertCoachFeedback } from "@/apis/coach";
import {
  learningSessionVersion,
  isLearningSessionCurrent,
} from "@/session/learning-session";
const props = defineProps<{
  requestId: string;
  feedback?: CoachFeedbackInput | null;
  disabled?: boolean;
}>();
const emit = defineEmits<{ saved: [feedback: CoachFeedbackInput] }>();
const rating = ref<CoachFeedbackInput["rating"]>(
  props.feedback?.rating ?? "UP",
);
const category = ref<NonNullable<CoachFeedbackInput["category"]> | "">(
  props.feedback?.category ?? "",
);
const comment = ref(props.feedback?.comment ?? "");
const editing = ref(false);
const saving = ref(false);
const notice = ref(props.feedback ? "已提交反馈，可修改。" : "");
let attempt: { fingerprint: string; key: string } | null = null;
let active = true;
const version = learningSessionVersion();
onBeforeUnmount(() => {
  active = false;
});
async function save() {
  if (saving.value || props.disabled) return;
  const body: CoachFeedbackInput = {
    rating: rating.value,
    category: category.value || null,
    comment: comment.value.trim() || null,
  };
  const fingerprint = JSON.stringify(body);
  if (attempt?.fingerprint !== fingerprint)
    attempt = { fingerprint, key: `feedback-${crypto.randomUUID()}` };
  saving.value = true;
  try {
    const response = await upsertCoachFeedback(
      props.requestId,
      body,
      attempt!.key,
    );
    if (!active || !isLearningSessionCurrent(version)) return;
    emit("saved", response.data);
    notice.value = "反馈已保存，谢谢。";
    editing.value = false;
    attempt = null;
  } catch {
    if (active && isLearningSessionCurrent(version))
      notice.value = "反馈保存失败，请重试。";
  } finally {
    if (active) saving.value = false;
  }
}
</script>
<template>
  <section
    class="mt-2 rounded-xl border border-slate-200 bg-white p-3 text-sm"
    aria-label="回答反馈"
  >
    <button
      type="button"
      class="text-blue-700 disabled:opacity-50"
      :disabled="disabled || saving"
      @click="editing = !editing"
    >
      {{ feedback ? "修改反馈" : "评价这条回答" }}
    </button>
    <form v-if="editing" class="mt-3 space-y-3" @submit.prevent="save">
      <fieldset :disabled="saving || disabled" class="space-y-3">
        <legend class="mb-2 font-medium">这条回答对你有帮助吗？</legend>
        <label class="mr-4"
          ><input v-model="rating" type="radio" value="UP" /> 有帮助</label
        >
        <label
          ><input v-model="rating" type="radio" value="DOWN" /> 需要改进</label
        >
        <label class="block"
          >反馈原因（选填）
          <select v-model="category" class="ml-2 rounded border p-1">
            <option value="">请选择</option>
            <option value="INCORRECT">内容不正确</option>
            <option value="TOO_HARD">太难</option>
            <option value="TOO_EASY">太简单</option>
            <option value="IRRELEVANT">不相关</option>
            <option value="UNSAFE">内容不合适</option>
            <option value="OTHER">其他</option>
          </select>
        </label>
        <label class="block"
          >补充说明（选填，最多 1000 字）
          <textarea
            v-model="comment"
            maxlength="1000"
            rows="2"
            class="mt-1 w-full rounded border p-2"
          />
        </label>
        <button
          type="submit"
          class="rounded-lg bg-blue-600 px-3 py-2 text-white"
        >
          {{ saving ? "正在保存…" : "提交反馈" }}
        </button>
      </fieldset>
    </form>
    <p v-if="notice" role="status" class="mt-2 text-slate-600">{{ notice }}</p>
  </section>
</template>
