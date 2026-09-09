<template>
  <GradingResult v-if="result.responseType === 'grading'" :result="result" />
  <article v-else class="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <section v-if="result.correction">
      <h3 class="text-xs font-semibold uppercase tracking-wide text-slate-500">纠正</h3>
      <p class="mt-1 whitespace-pre-wrap text-slate-900">{{ result.correction }}</p>
    </section>

    <section>
      <h3 class="text-xs font-semibold uppercase tracking-wide text-slate-500">讲解</h3>
      <p class="mt-1 whitespace-pre-wrap text-slate-800">{{ result.explanation }}</p>
    </section>

    <section v-if="result.examples.length">
      <h3 class="text-xs font-semibold uppercase tracking-wide text-slate-500">示例</h3>
      <ul class="mt-2 list-inside list-disc space-y-1 text-sm text-slate-700">
        <li v-for="example in result.examples" :key="example">{{ example }}</li>
      </ul>
    </section>

    <section v-if="result.errorTypes.length" class="flex flex-wrap gap-2">
      <span
        v-for="errorType in result.errorTypes"
        :key="errorType"
        class="rounded-full bg-rose-50 px-3 py-1 text-xs font-medium text-rose-700"
      >
        {{ errorType }}
      </span>
    </section>

    <section v-if="result.schemaVersion === 'coach.result.v1' && result.citations.length">
      <h3 class="text-xs font-semibold uppercase tracking-wide text-slate-500">学习依据</h3>
      <ul class="mt-2 space-y-2 text-sm text-slate-600">
        <li v-for="citation in result.citations" :key="citation.sourceId">
          <span class="font-medium text-slate-800">{{ citation.title }}</span>
          <span>：{{ citation.supports }}</span>
        </li>
      </ul>
    </section>

    <section v-if="result.schemaVersion === 'coach.result.v2' && v2Citations.length">
      <h3 class="text-xs font-semibold uppercase tracking-wide text-slate-500">学习依据</h3>
      <ul class="mt-2 space-y-2">
        <CitationCard
          v-for="citation in v2Citations"
          :key="citation.citationId"
          :citation="citation"
          :claims="claimsFor(citation.citationId)"
          @open="openCitation"
        />
      </ul>
    </section>

    <footer class="rounded-xl bg-blue-50 p-3 text-sm text-blue-900">
      <h3 class="font-semibold">为什么推荐这一步</h3>
      <p class="mt-1">
        <span class="font-medium">建议{{ actionLabel }}：</span>{{ result.nextActionReason }}
      </p>
    </footer>
  </article>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import router from '@/router'
import { controlledCitationRoute } from '@/apis/coach'
import type {
  AnyPublicCoachResult,
  CitationLocator,
  GroundedClaim,
  PublicCoachCitationV2,
} from '@en/common/coach'
import GradingResult from './GradingResult.vue'
import CitationCard from './CitationCard.vue'

const props = defineProps<{ result: AnyPublicCoachResult }>()
const actionLabel = computed(() => ({
  review: '复习',
  practice: '练习',
  continue: '继续学习',
})[props.result.nextAction])

const v2Citations = computed<PublicCoachCitationV2[]>(() => {
  if (props.result.schemaVersion !== 'coach.result.v2') return []
  return [...new Map(
    props.result.citations.map((citation) => [citation.citationId, citation]),
  ).values()]
})

function claimsFor(citationId: string): GroundedClaim[] {
  if (props.result.schemaVersion !== 'coach.result.v2') return []
  return props.result.groundedClaims.filter((claim) =>
    claim.citationIds.includes(citationId),
  )
}

async function openCitation(locator: CitationLocator) {
  const route = controlledCitationRoute(locator)
  if (route) await router.push(route)
}
</script>
