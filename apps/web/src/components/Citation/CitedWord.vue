<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { getCitedWord, type CitedWord } from "@/apis/word-book";
import { onLearningSessionChange } from "@/session/learning-session";
const route = useRoute();
const entry = ref<CitedWord | null>(null);
const loading = ref(false);
const error = ref("");
const panel = ref<HTMLElement | null>(null);
let generation = 0;
let active = true;
async function load() {
  const epoch = ++generation;
  entry.value = null;
  error.value = "";
  loading.value = false;
  const id = route.query.citation;
  if (id == null) return;
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
    error.value = "引用地址无效。";
    return;
  }
  loading.value = true;
  try {
    const response = await getCitedWord(id);
    if (!active || epoch !== generation) return;
    if (!response.success || response.data?.word?.wordId !== id)
      throw new Error("Unavailable");
    entry.value = response.data;
    await nextTick();
    if (active && epoch === generation) {
      panel.value?.scrollIntoView?.({ block: "center" });
      panel.value?.focus();
    }
  } catch {
    if (active && epoch === generation)
      error.value = "引用的单词已删除、无权显示或暂时无法读取。";
  } finally {
    if (active && epoch === generation) loading.value = false;
  }
}
watch(() => route.query.citation, load, { immediate: true });
const unsubscribe = onLearningSessionChange(() => {
  generation++;
  entry.value = null;
  loading.value = false;
});
onBeforeUnmount(() => {
  active = false;
  generation++;
  unsubscribe();
});
</script>
<template>
  <section
    v-if="route.query.citation != null"
    ref="panel"
    tabindex="-1"
    aria-labelledby="cited-word-title"
    class="mb-6 rounded-xl border-2 border-blue-400 bg-white p-5 focus:outline-blue-500"
  >
    <h2 id="cited-word-title" class="text-lg font-semibold text-blue-800">
      引用的单词
    </h2>
    <p v-if="loading" role="status">正在定位引用…</p>
    <div v-else-if="error" role="status">
      <p>{{ error }}</p>
      <button type="button" class="mt-2 text-blue-700" @click="load">
        重新定位
      </button>
    </div>
    <template v-else-if="entry">
      <h3 class="mt-2 text-xl font-bold">{{ entry.word.word }}</h3>
      <p>{{ entry.word.phonetic }}</p>
      <p class="mt-2 whitespace-pre-wrap">{{ entry.word.definition }}</p>
      <p class="mt-2 whitespace-pre-wrap">{{ entry.word.translation }}</p>
      <p v-if="entry.forms.length" class="mt-2">
        词形：{{ entry.forms.join("、") }}
      </p>
      <ul v-if="entry.examples.length" class="mt-2 list-inside list-disc">
        <li v-for="example in entry.examples" :key="example">{{ example }}</li>
      </ul>
    </template>
  </section>
</template>
