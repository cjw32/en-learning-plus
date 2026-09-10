<template>
  <li
    class="rounded-xl border border-slate-200 bg-slate-50 p-3"
    :data-citation-id="citation.citationId"
  >
    <template v-if="citation.status === 'active'">
      <header class="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p class="text-xs font-medium text-slate-500">{{ sourceLabel }}</p>
          <h4 class="font-semibold text-slate-900">{{ citation.title }}</h4>
        </div>
        <span class="rounded-full bg-blue-50 px-2 py-1 text-xs text-blue-700">
          {{ categoryLabel }}
        </span>
      </header>
      <p class="mt-2 text-sm text-slate-700">{{ citation.excerpt }}</p>
      <section v-if="claims.length" class="mt-3 border-t border-slate-200 pt-2">
        <p class="text-xs font-medium text-slate-500">关联内容</p>
        <ul class="mt-1 space-y-1 text-xs text-slate-600">
          <li v-for="claim in claims" :key="claim.claimId">{{ claim.text }}</li>
        </ul>
      </section>
      <button
        v-if="citation.locator"
        type="button"
        data-open-citation
        class="mt-3 text-xs font-medium text-blue-700 hover:text-blue-900"
        @click="emit('open', citation.locator)"
      >
        打开学习内容
      </button>
    </template>
    <template v-else>
      <p class="text-sm font-medium text-slate-600">来源当前不可用</p>
      <p class="mt-1 text-xs text-slate-500">此引用无法继续展示。</p>
    </template>
  </li>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type {
  CitationLocator,
  GroundedClaim,
  PublicCoachCitationV2,
} from '@en/common/coach'

const props = defineProps<{
  citation: PublicCoachCitationV2
  claims: GroundedClaim[]
}>()
const emit = defineEmits<{ open: [locator: CitationLocator] }>()

const sourceLabel = computed(() => {
  if (props.citation.status !== 'active') return ''
  if (props.citation.accessScope === 'PRIVATE_OWNER') return '你的学习记录'
  if (props.citation.accessScope === 'OWNED_COURSE') return '已购课程'
  return props.citation.source
})

const categoryNames = {
  WORD_MEANING: '词义',
  WORD_TRANSLATION: '翻译',
  WORD_PRONUNCIATION: '发音',
  WORD_FORM: '词形',
  WORD_USAGE: '用法',
  COLLOCATION: '搭配',
  EXAMPLE_SENTENCE: '例句',
  GRAMMAR_RULE: '语法规则',
  GRAMMAR_EXCEPTION: '语法例外',
  COURSE_LESSON: '课程',
  EXERCISE_KNOWLEDGE: '练习知识',
  USER_ERROR: '错题记录',
  LEARNING_SUMMARY: '学习总结',
} as const

const categoryLabel = computed(() =>
  props.citation.status === 'active'
    ? categoryNames[props.citation.category]
    : '',
)
</script>
