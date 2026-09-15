<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, nextTick } from "vue";
import type { PronunciationAssessmentResource } from "@en/common/pronunciation";
import {
  deletePronunciationAssessment,
  deletePronunciationAudio,
  getPronunciationAudio,
  listPronunciationAssessments,
} from "@/apis/pronunciation";

import PronunciationAssessmentResult from './PronunciationAssessmentResult.vue';
import { onLearningSessionChange } from '@/session/learning-session';
const nextCursor = ref<string | null>(null);
const selectedId = ref<string | null>(null);
let active = true;
let generation = 0;
let listGeneration = 0;
let playGeneration = 0;
const items = ref<PronunciationAssessmentResource[]>([]);
const loading = ref(true);
const statusMessage = ref("");
const audioUrls = new Map<string, string>();
const playingId = ref<string | null>(null);

function key(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().replaceAll("-", "")}`;
}

function revoke(assessmentId: string): void {
  const url = audioUrls.get(assessmentId);
  if (url) URL.revokeObjectURL(url);
  audioUrls.delete(assessmentId);
  if (playingId.value === assessmentId) playingId.value = null;
}

async function load(more = false): Promise<void> {
  const current = generation;
  const sequence = ++listGeneration;
  loading.value = true;
  statusMessage.value = "";
  try {
    const response = await listPronunciationAssessments({ limit: 20, cursor: more ? nextCursor.value ?? undefined : undefined });
    if (!active || current !== generation || sequence !== listGeneration) return;
    items.value = more ? [...items.value, ...response.data.items] : [...response.data.items];
    nextCursor.value = response.data.nextCursor;
  } catch {
    if (active && current === generation && sequence === listGeneration)
      statusMessage.value = "暂时无法读取发音评测历史。";
  } finally {
    if (active && current === generation && sequence === listGeneration) loading.value = false;
  }
}

async function play(assessmentId: string): Promise<void> {
  const current = generation;
  const sequence = ++playGeneration;
  for (const id of audioUrls.keys()) revoke(id);
  try {
    const blob = await getPronunciationAudio(assessmentId);
    if (!active || current !== generation || sequence !== playGeneration) return;
    audioUrls.set(assessmentId, URL.createObjectURL(blob));
    playingId.value = assessmentId;
  } catch {
    if (active && current === generation && sequence === playGeneration)
      statusMessage.value = "录音已过期、已撤销或暂不可播放。";
  }
}

async function deleteAudio(assessmentId: string): Promise<void> {
  if (!window.confirm("仅删除录音并保留评测结果与学习历史？")) return;
  const current = generation;
  try {
    await deletePronunciationAudio(
      assessmentId,
      key("pronunciation-delete-audio"),
    );
    if (!active || current !== generation) return;
    invalidateReads();
    revoke(assessmentId);
    items.value = items.value.map((item) =>
      item.assessmentId === assessmentId
        ? {
            ...item,
            audio: { ...item.audio, status: "REVOKED", available: false },
          }
        : item,
    );
    statusMessage.value = "录音已撤销；评测结果仍保留。";
  } catch {
    statusMessage.value = "录音删除请求失败，请稍后重试。";
  }
}

async function deleteAssessment(assessmentId: string): Promise<void> {
  if (
    !window.confirm(
      "删除完整评测并重新计算相关学习影响？此操作会立即隐藏结果。",
    )
  )
    return;
  const current = generation;
  try {
    await deletePronunciationAssessment(
      assessmentId,
      key("pronunciation-delete-assessment"),
    );
    if (!active || current !== generation) return;
    invalidateReads();
    nextCursor.value = null;
    if (selectedId.value === assessmentId) selectedId.value = null;
    revoke(assessmentId);
    items.value = items.value.filter(
      (item) => item.assessmentId !== assessmentId,
    );
    statusMessage.value = "评测已隐藏，学习影响正在安全重算。";
  } catch {
    statusMessage.value = "评测删除请求失败，请稍后重试。";
  }
}

async function seek(assessmentId: string, milliseconds: number) {
  if (playingId.value !== assessmentId) await play(assessmentId);
  await nextTick();
  const audio = document.getElementById(`pronunciation-audio-${assessmentId}`) as HTMLAudioElement | null;
  if (!audio) return;
  const position = () => { audio.currentTime = milliseconds / 1000; void audio.play().catch(() => {}); };
  if (audio.readyState >= 1) position();
  else audio.addEventListener('loadedmetadata', position, { once: true });
}
function invalidateReads() {
  listGeneration++;
  playGeneration++;
  loading.value = false;
}
function reset() {
  generation++; invalidateReads(); items.value = []; selectedId.value = null;
  nextCursor.value = null;
  statusMessage.value = "";
  for (const id of [...audioUrls.keys()]) revoke(id);
}
const unsubscribe = onLearningSessionChange(reset);
onMounted(() => load());
defineExpose({ load });
onBeforeUnmount(() => { active = false; unsubscribe(); reset(); });
</script>

<template>
  <section
    class="pronunciation-history"
    aria-labelledby="pronunciation-history-title"
  >
    <h2 id="pronunciation-history-title">发音评测历史</h2>
    <p v-if="loading">正在读取…</p>
    <p v-else-if="items.length === 0">暂无可显示的评测。</p>
    <ul v-else>
      <li v-for="item in items" :key="item.assessmentId">
        <div>
          <strong>{{ item.referenceText }}</strong>
          <time :datetime="item.createdAt">{{
            new Date(item.createdAt).toLocaleString()
          }}</time>
        </div>
        <audio
          v-if="playingId === item.assessmentId"
          :id="`pronunciation-audio-${item.assessmentId}`"
          controls
          :src="audioUrls.get(item.assessmentId)"
        />
        <p v-if="item.result">{{ Math.round(item.result.scores.overall) }} 分 · {{ item.result.confidenceTier === 'RELIABLE' ? '结果可靠' : '仅供参考' }}</p>
        <p v-else>{{ item.diagnostic?.message ?? '尚未完成评测' }}</p>
        <PronunciationAssessmentResult v-if="selectedId === item.assessmentId && item.result" :result="item.result" @seek="seek(item.assessmentId, $event)" />
        <div class="pronunciation-history__actions">
          <button v-if="item.result" type="button" @click="selectedId = selectedId === item.assessmentId ? null : item.assessmentId">{{ selectedId === item.assessmentId ? '收起结果' : '查看结果' }}</button>
          <button
            v-if="item.audio.available"
            type="button"
            data-action="play"
            @click="play(item.assessmentId)"
          >
            播放录音
          </button>
          <button
            v-if="item.audio.available"
            type="button"
            data-action="delete-audio"
            @click="deleteAudio(item.assessmentId)"
          >
            仅删除录音
          </button>
          <button
            type="button"
            data-action="delete-assessment"
            @click="deleteAssessment(item.assessmentId)"
          >
            删除完整评测
          </button>
        </div>
      </li>
    </ul>
    <button v-if="nextCursor" type="button" :disabled="loading" @click="load(true)">加载更多</button>
    <button type="button" :disabled="loading" @click="load()">刷新记录</button>
    <p v-if="statusMessage" role="status">{{ statusMessage }}</p>
  </section>
</template>

<style scoped>
.pronunciation-history {
  display: grid;
  gap: 1rem;
}
.pronunciation-history ul {
  display: grid;
  gap: 0.8rem;
  padding: 0;
  list-style: none;
}
.pronunciation-history li {
  display: grid;
  gap: 0.7rem;
  padding: 1rem;
  border: 1px solid #e1e5ec;
  border-radius: 0.8rem;
}
.pronunciation-history time {
  display: block;
  color: #566077;
  font-size: 0.8rem;
}
.pronunciation-history__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.pronunciation-history button {
  min-height: 2.4rem;
  padding: 0.45rem 0.7rem;
}
</style>
