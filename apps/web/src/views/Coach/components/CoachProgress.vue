<template>
  <section
    v-if="state !== 'idle'"
    class="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700"
    aria-live="polite"
    data-test="coach-progress"
  >
    <div class="flex items-center gap-2">
      <span
        class="h-2.5 w-2.5 rounded-full"
        :class="terminal ? 'bg-slate-400' : 'animate-pulse bg-blue-500'"
      />
      <span>{{ label }}</span>
    </div>
    <p v-if="toolStatus" class="mt-1 text-xs text-slate-500">
      {{ toolStatus.tool }} · {{ toolStatus.state }}
    </p>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { CoachSseEvent } from '@en/common/coach'
import type { CoachStreamState } from '@/stores/coach'

const props = withDefaults(
  defineProps<{
    state: CoachStreamState
    serverLabel?: string
    toolStatus?: Extract<CoachSseEvent, { type: 'tool_status' }>['payload'] | null
  }>(),
  { serverLabel: '', toolStatus: null },
)
const terminal = computed(() =>
  ['completed', 'cancelled', 'failed', 'timed_out', 'budget_exceeded'].includes(
    props.state,
  ),
)
const fallbackLabels: Record<CoachStreamState, string> = {
  idle: '',
  connecting: '正在连接 Coach',
  reconciling: '正在读取可靠的请求状态',
  queued: '请求已进入队列',
  generating: 'Coach 正在生成内容',
  tool_running: 'Coach 正在使用学习工具',
  grading: '正在批改答案',
  saving: '正在保存学习进度',
  completed: 'Coach 已完成',
  cancelled: '请求已取消',
  failed: '请求失败',
  timed_out: '请求超时',
  budget_exceeded: '请求已达到预算上限',
}
const label = computed(() => props.serverLabel || fallbackLabels[props.state])
</script>
