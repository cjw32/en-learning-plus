<template>
  <section class="rounded-xl border p-4" :class="toneClass" aria-live="polite">
    <h3 class="text-sm font-semibold">{{ statusTitle }}</h3>
    <p v-if="update.status === 'not_saved'" class="mt-1 text-sm">
      批改结果仍可查看；本次没有更新掌握度或复习时间，请安全重试。
    </p>
    <ul v-else class="mt-3 space-y-3">
      <li
        v-for="change in update.changes"
        :key="`${change.targetType}:${change.targetKey}`"
        class="rounded-lg bg-white/70 p-3 text-sm"
      >
        <p class="font-medium">{{ change.label }}</p>
        <p class="mt-1">
          <span class="sr-only">保存前后状态：</span>
          {{ change.previousState }} → {{ change.nextState }}
        </p>
        <p class="mt-1 text-xs opacity-80">
          下次复习：<time :datetime="change.nextReviewAt">{{ formatDate(change.nextReviewAt) }}</time>
          · {{ change.reason }}
        </p>
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { CoachResult } from '@en/common/coach'

type LearningUpdate = NonNullable<CoachResult['learningUpdate']>
const props = defineProps<{ update: LearningUpdate }>()

const statusTitle = computed(() => {
  if (props.update.status === 'saved') return '学习状态已更新'
  if (props.update.status === 'replayed') return '此前已保存，本次已安全确认'
  return '批改完成，但学习记录未保存'
})
const toneClass = computed(() =>
  props.update.status === 'not_saved'
    ? 'border-amber-200 bg-amber-50 text-amber-900'
    : 'border-emerald-200 bg-emerald-50 text-emerald-900',
)

function formatDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}
</script>
