<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import type { PronunciationAssessmentResource } from "@en/common/pronunciation";
import {
  deletePronunciationAssessment,
  deletePronunciationAudio,
  getPronunciationAudio,
  listPronunciationAssessments,
} from "@/apis/pronunciation";

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

async function load(): Promise<void> {
  loading.value = true;
  try {
    const response = await listPronunciationAssessments({ limit: 50 });
    items.value = [...response.data.items];
  } catch {
    statusMessage.value = "暂时无法读取发音评测历史。";
  } finally {
    loading.value = false;
  }
}

async function play(assessmentId: string): Promise<void> {
  revoke(assessmentId);
  try {
    const blob = await getPronunciationAudio(assessmentId);
    audioUrls.set(assessmentId, URL.createObjectURL(blob));
    playingId.value = assessmentId;
  } catch {
    statusMessage.value = "录音已过期、已撤销或暂不可播放。";
  }
}

async function deleteAudio(assessmentId: string): Promise<void> {
  if (!window.confirm("仅删除录音并保留评测结果与学习历史？")) return;
  try {
    await deletePronunciationAudio(
      assessmentId,
      key("pronunciation-delete-audio"),
    );
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
  try {
    await deletePronunciationAssessment(
      assessmentId,
      key("pronunciation-delete-assessment"),
    );
    revoke(assessmentId);
    items.value = items.value.filter(
      (item) => item.assessmentId !== assessmentId,
    );
    statusMessage.value = "评测已隐藏，学习影响正在安全重算。";
  } catch {
    statusMessage.value = "评测删除请求失败，请稍后重试。";
  }
}

onMounted(load);
onBeforeUnmount(() => {
  for (const assessmentId of [...audioUrls.keys()]) revoke(assessmentId);
});
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
          controls
          :src="audioUrls.get(item.assessmentId)"
        />
        <div class="pronunciation-history__actions">
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
