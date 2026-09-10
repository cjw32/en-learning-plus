<template>
  <section
    v-if="exercise"
    class="space-y-5 rounded-2xl border border-blue-200 bg-white p-5 shadow-sm"
  >
    <header class="flex items-start justify-between gap-3">
      <div>
        <p class="text-xs font-semibold uppercase tracking-wide text-blue-600">
          {{ typeLabel }} · {{ exercise.cefrDifficulty }}
        </p>
        <h2 class="mt-1 text-lg font-semibold text-slate-900">
          {{ exercise.instructions }}
        </h2>
      </div>
    </header>
    <p class="rounded-xl bg-blue-50 p-3 text-sm text-blue-900">
      {{ exercise.personalizationReason }}
    </p>

    <form class="space-y-5" @submit.prevent="submit">
      <fieldset
        v-for="item in exercise.items"
        :key="item.id"
        class="rounded-xl border border-slate-200 p-4"
      >
        <legend class="px-2 text-sm font-medium text-slate-900">
          {{ item.position }}. {{ item.prompt }}
        </legend>
        <div v-if="item.choices" class="mt-3 space-y-2">
          <label
            v-for="choice in item.choices"
            :key="choice.id"
            class="flex items-center gap-2 text-sm text-slate-700"
          >
            <input
              v-model="answers[item.id]"
              type="radio"
              :name="item.id"
              :value="choice.id"
            />
            {{ choice.text }}
          </label>
        </div>
        <textarea
          v-else
          v-model.trim="answers[item.id]"
          rows="2"
          maxlength="4000"
          class="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          placeholder="输入你的答案"
        />
        <PronunciationEntry
          v-if="coachRequestId"
          class="mt-3"
          compact
          :enabled="pronunciationCaptureEnabled"
          :target="{
            sourceType: 'COACH_EXERCISE',
            coachRequestId,
            exerciseId: exercise.id,
            itemId: item.id,
          }"
        />
      </fieldset>
      <button
        type="submit"
        class="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        :disabled="!canSubmit || submitting"
      >
        {{ submitting ? '正在批改…' : '提交答案' }}
      </button>
    </form>
  </section>
  <section
    v-else-if="degradedMessage"
    class="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800"
  >
    {{ degradedMessage }}
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import type { AnyPublicCoachResult } from '@en/common/coach';
import PronunciationEntry from '@/components/Pronunciation/PronunciationEntry.vue';

type Exercise = NonNullable<AnyPublicCoachResult['exercise']>;
const props = withDefaults(
  defineProps<{
    exercise: Exercise | null;
    degradedMessage?: string;
    submitting?: boolean;
    coachRequestId?: string | null;
  }>(),
  { degradedMessage: '', submitting: false, coachRequestId: null },
);
const pronunciationCaptureEnabled =
  import.meta.env.VITE_PRONUNCIATION_CAPTURE_ENABLED === 'true';
const emit = defineEmits<{
  submit: [answers: Array<{ itemId: string; answer: string }>];
}>();
const answers = reactive<Record<string, string>>({});
const typeNames: Record<Exercise['type'], string> = {
  MULTIPLE_CHOICE: '选择题',
  FILL_BLANK: '填空题',
  TRANSLATION: '翻译题',
  SITUATIONAL_DIALOGUE: '情境对话',
};
const typeLabel = computed(() =>
  props.exercise ? typeNames[props.exercise.type] : '',
);
const canSubmit = computed(
  () =>
    Boolean(props.exercise?.items.length) &&
    props.exercise!.items.every((item) => Boolean(answers[item.id]?.trim())),
);

watch(
  () => props.exercise?.id,
  () => {
    for (const key of Object.keys(answers)) delete answers[key];
  },
);

function submit() {
  if (!props.exercise || !canSubmit.value) return;
  emit(
    'submit',
    props.exercise.items.map((item) => ({
      itemId: item.id,
      answer: answers[item.id]!,
    })),
  );
}
</script>
