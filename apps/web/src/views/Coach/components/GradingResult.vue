<template>
  <article class="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <header class="flex items-center justify-between gap-4">
      <div>
        <p class="text-xs font-semibold uppercase tracking-wide text-slate-500">本次得分</p>
        <p class="mt-1 text-3xl font-bold text-blue-700">{{ result.score }}</p>
      </div>
    </header>

    <section class="rounded-xl bg-blue-50 p-3 text-sm text-blue-900">
      <h3 class="font-semibold">为什么推荐这一步</h3>
      <p class="mt-1">
        <span class="font-medium">建议{{ actionLabel }}：</span>{{ result.nextActionReason }}
      </p>
    </section>

    <section v-if="result.correction">
      <h3 class="text-sm font-semibold text-slate-900">参考纠正</h3>
      <p class="mt-1 whitespace-pre-wrap text-sm text-slate-700">{{ result.correction }}</p>
    </section>
    <section>
      <h3 class="text-sm font-semibold text-slate-900">批改讲解</h3>
      <p class="mt-1 whitespace-pre-wrap text-sm text-slate-700">{{ result.explanation }}</p>
    </section>

    <ol class="space-y-3">
      <li
        v-for="(item, index) in result.gradingItems"
        :key="item.itemId"
        class="rounded-xl border border-slate-200 p-4"
      >
        <div class="flex items-center justify-between gap-3">
          <h3 class="font-medium text-slate-900">第 {{ index + 1 }} 题</h3>
          <span :class="item.isCorrect ? 'text-emerald-700' : 'text-rose-700'">
            {{ item.score }} 分 · {{ item.isCorrect ? '正确' : '需改进' }}
          </span>
        </div>
        <p v-if="item.correction" class="mt-2 text-sm text-slate-800">
          纠正：{{ item.correction }}
        </p>
        <p class="mt-1 text-sm text-slate-600">{{ item.explanation }}</p>
        <div v-if="item.errorTypes.length" class="mt-2 flex flex-wrap gap-2">
          <span
            v-for="errorType in item.errorTypes"
            :key="errorType"
            class="rounded-full bg-rose-50 px-2 py-1 text-xs text-rose-700"
          >
            {{ errorType }}
          </span>
        </div>
      </li>
    </ol>

    <section v-if="result.examples.length">
      <h3 class="text-sm font-semibold text-slate-900">示例</h3>
      <ul class="mt-2 list-inside list-disc text-sm text-slate-700">
        <li v-for="example in result.examples" :key="example">{{ example }}</li>
      </ul>
    </section>

    <LearningUpdate v-if="result.learningUpdate" :update="result.learningUpdate" />
  </article>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { CoachResult } from '@en/common/coach'
import LearningUpdate from './LearningUpdate.vue'

const props = defineProps<{ result: CoachResult }>()
const actionLabel = computed(() => ({
  review: '复习',
  practice: '练习',
  continue: '继续学习',
})[props.result.nextAction])
</script>
