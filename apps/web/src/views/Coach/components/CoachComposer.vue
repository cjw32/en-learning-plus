<template>
  <form class="border-t border-slate-200 bg-white p-4" @submit.prevent="submit">
    <textarea
      v-model="message"
      rows="3"
      maxlength="8000"
      class="w-full resize-none rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-blue-500"
      placeholder="可以问单词、语法、句子纠错或学习方法…"
      :disabled="pending || disabled"
      @keydown.ctrl.enter="submit"
      @keydown.meta.enter="submit"
    />
    <div
      class="mt-3 grid gap-3 rounded-xl bg-slate-50 p-3 sm:grid-cols-[auto_1fr_100px]"
    >
      <label class="flex items-center gap-2 text-sm text-slate-700">
        <input v-model="exerciseMode" type="checkbox" />
        生成练习
      </label>
      <label class="text-xs text-slate-500">
        题型
        <select
          v-model="exerciseType"
          class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-800"
          :disabled="!exerciseMode || pending || disabled"
        >
          <option value="MULTIPLE_CHOICE">选择题</option>
          <option value="FILL_BLANK">填空题</option>
          <option value="TRANSLATION">翻译题</option>
          <option value="SITUATIONAL_DIALOGUE">情境对话</option>
        </select>
      </label>
      <label class="text-xs text-slate-500">
        题量
        <input
          v-model.number="exerciseCount"
          data-test="exercise-count"
          type="number"
          min="1"
          max="20"
          class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-800"
          :disabled="!exerciseMode || pending || disabled"
        />
      </label>
    </div>
    <div class="mt-3 flex items-center justify-between gap-3">
      <span class="text-xs text-slate-400">Ctrl / ⌘ + Enter 发送</span>
      <div class="flex gap-2">
        <button
          v-if="pending"
          type="button"
          class="rounded-lg border border-slate-300 px-4 py-2 text-sm"
          @click="$emit('cancel')"
        >
          取消
        </button>
        <button
          v-if="retryable && !pending && !disabled"
          type="button"
          class="rounded-lg border border-blue-300 px-4 py-2 text-sm text-blue-700"
          @click="$emit('retry')"
        >
          重试
        </button>
        <button
          type="submit"
          class="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white disabled:opacity-50"
          :disabled="pending || disabled || message.trim().length === 0"
        >
          {{ pending ? "Coach 正在处理…" : "发送" }}
        </button>
      </div>
    </div>
  </form>
</template>

<script setup lang="ts">
import { ref } from "vue";
import type { ExerciseType } from "@en/common/coach";

const props = withDefaults(
  defineProps<{ pending?: boolean; retryable?: boolean; disabled?: boolean }>(),
  {
    pending: false,
    retryable: false,
    disabled: false,
  },
);
const emit = defineEmits<{
  submit: [
    message: string,
    exercisePreferences?: { types: ExerciseType[]; count: number },
  ];
  cancel: [];
  retry: [];
}>();
const message = ref("");
const exerciseMode = ref(false);
const exerciseType = ref<ExerciseType>("MULTIPLE_CHOICE");
const exerciseCount = ref(5);

function submit() {
  const value = message.value.trim();
  if (!value || props.pending || props.disabled) return;
  emit(
    "submit",
    value,
    exerciseMode.value
      ? {
          types: [exerciseType.value],
          count: Math.min(20, Math.max(1, exerciseCount.value)),
        }
      : undefined,
  );
  message.value = "";
}
</script>
