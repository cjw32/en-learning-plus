<script setup lang="ts">
import { computed, ref } from 'vue';
import type { PronunciationLocale, PronunciationTargetInput } from '@en/common/pronunciation';
import PronunciationEntry from '@/components/Pronunciation/PronunciationEntry.vue';
import PronunciationHistory from '@/components/Pronunciation/PronunciationHistory.vue';
import { usePronunciationCapabilities } from '@/hooks/usePronunciationCapabilities';
const { available, loading, refresh } = usePronunciationCapabilities();
const text = ref('');
const locale = ref<PronunciationLocale>('en-US');
const target = ref<PronunciationTargetInput | null>(null);
const practiceLocale = ref<PronunciationLocale>('en-US');
const practiceId = ref(0);
const history = ref<{ load(): Promise<void> } | null>(null);
const words = computed(() => text.value.trim().split(/\s+/).filter(Boolean).length);
const valid = computed(() => /^[A-Za-z][A-Za-z\s.,!?;:'"()’–—-]*$/.test(text.value.trim()) && words.value <= 30 && text.value.trim().length <= 200);
function prepare() {
  if (!available.value || !valid.value) return;
  target.value = { sourceType: 'MANUAL', text: text.value.trim() };
  practiceLocale.value = locale.value;
  practiceId.value++;
}
</script>

<template>
  <main class="pronunciation-page">
    <header><h1>发音练习</h1><p>先听标准发音，再录下你的声音，查看逐词反馈和练习建议。</p></header>
    <section class="practice-card" aria-label="选择练习内容">
      <p v-if="loading" role="status">正在检查评测服务…</p>
      <div v-else-if="!available" role="status">
        <p>发音评测暂未开放，当前无法开始新评测。已有记录仍可在下方查看。</p>
        <button type="button" @click="refresh">重新检查</button>
      </div>
      <form v-else @submit.prevent="prepare">
        <label for="pronunciation-text">要练习的英文</label>
        <textarea id="pronunciation-text" v-model="text" maxlength="200" rows="3" placeholder="例如：Good morning. How are you today?" />
        <p class="hint">{{ words }} / 30 词 · {{ text.length }} / 200 字符 · 录音最长 30 秒</p>
        <label for="pronunciation-locale">发音标准</label>
        <select id="pronunciation-locale" v-model="locale"><option value="en-US">美式英语</option><option value="en-GB">英式英语</option></select>
        <p v-if="text && !valid" role="alert">请输入英文单词或短句，最多 30 词、200 字符。</p>
        <button type="submit" :disabled="!valid">准备练习</button>
      </form>
      <PronunciationEntry v-if="target" :key="practiceId" :target="target" :locale="practiceLocale" :enabled="available" @completed="history?.load()" />
    </section>
    <PronunciationHistory ref="history" />
  </main>
</template>

<style scoped>
.pronunciation-page { max-width: 960px; width: 100%; margin: 0 auto; padding: 2rem 1rem; display: grid; gap: 2rem; color: #20283a; }
h1 { font-size: 1.8rem; font-weight: 700; } header p, .hint { color: #566077; margin-top: .5rem; }
.practice-card { padding: 1.5rem; border: 1px solid #e1e5ec; border-radius: 1rem; display: grid; gap: 1.5rem; background: white; }
form { display: grid; gap: .75rem; } label { font-weight: 600; }
textarea, select { padding: .75rem; border: 1px solid #bac3d4; border-radius: .5rem; } select { width: fit-content; }
button { padding: .6rem 1rem; border-radius: .5rem; background: #eef2ff; color: #2845ae; width: fit-content; } button:disabled { opacity: .5; }
</style>
