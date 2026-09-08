<template>
  <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <div class="mb-4 flex items-start justify-between gap-3">
      <div>
        <h2 class="text-base font-semibold text-slate-900">学习画像</h2>
        <p class="mt-1 text-sm text-slate-500">
          Coach 会据此调整讲解难度和练习内容。
        </p>
      </div>
      <span
        v-if="profile.cefrLevel === null"
        class="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700"
      >
        完善英语水平
      </span>
    </div>

    <form class="space-y-4" @submit.prevent="submit">
      <label class="block text-sm text-slate-700">
        英语水平
        <select
          v-model="form.cefrLevel"
          class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
        >
          <option :value="null">尚未设置</option>
          <option v-for="level in levels" :key="level" :value="level">
            {{ level }}
          </option>
        </select>
      </label>

      <label class="block text-sm text-slate-700">
        学习目标
        <select
          v-model="form.goalType"
          class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
        >
          <option :value="null">尚未设置</option>
          <option value="GENERAL">综合提升</option>
          <option value="EXAM">考试</option>
          <option value="BUSINESS">商务</option>
          <option value="TRAVEL">旅行</option>
          <option value="CUSTOM">自定义</option>
        </select>
      </label>

      <label v-if="form.goalType === 'CUSTOM'" class="block text-sm text-slate-700">
        目标说明
        <input
          v-model.trim="form.goalText"
          maxlength="500"
          class="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
          placeholder="例如：能用英语参加技术面试"
        />
      </label>

      <button
        type="submit"
        class="w-full rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        :disabled="saving"
      >
        {{ saving ? '正在保存…' : '保存画像' }}
      </button>
    </form>
  </section>
</template>

<script setup lang="ts">
import { reactive, watch } from 'vue'
import type { CoachProfile, CoachProfileUpdate } from '@en/common/coach'

const props = withDefaults(
  defineProps<{ profile: CoachProfile; saving?: boolean }>(),
  { saving: false },
)
const emit = defineEmits<{ save: [update: CoachProfileUpdate] }>()

const levels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const
const form = reactive<{
  cefrLevel: CoachProfile['cefrLevel']
  goalType: CoachProfile['goalType']
  goalText: string
}>({
  cefrLevel: props.profile.cefrLevel,
  goalType: props.profile.goalType,
  goalText: props.profile.goalText ?? '',
})

watch(
  () => props.profile,
  (profile) => {
    form.cefrLevel = profile.cefrLevel
    form.goalType = profile.goalType
    form.goalText = profile.goalText ?? ''
  },
)

function submit() {
  emit('save', {
    cefrLevel: form.cefrLevel,
    goalType: form.goalType,
    goalText: form.goalType === 'CUSTOM' ? form.goalText : null,
  })
}
</script>
