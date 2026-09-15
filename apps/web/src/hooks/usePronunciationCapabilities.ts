import { getActivePinia } from 'pinia';
import { useUserStore } from '@/stores/user';
import { computed, onMounted, onScopeDispose, ref } from 'vue';
import type { PronunciationCapabilities } from '@en/common/pronunciation';
import { getPronunciationCapabilities } from '@/apis/pronunciation';
import { isLearningSessionCurrent, learningSessionVersion, onLearningSessionChange } from '@/session/learning-session';

// Cache only non-sensitive capability flags; invalidate on account replacement.
let pending: Promise<PronunciationCapabilities> | null = null;
let cached: { at: number; value: PronunciationCapabilities } | null = null;
onLearningSessionChange(() => { pending = null; cached = null; });
export function usePronunciationCapabilities() {
  const capabilities = ref<PronunciationCapabilities | null>(null);
  const loading = ref(false);
  const failed = ref(false);
  let disposed = false;
  async function refresh() {
    if (!getActivePinia() || !useUserStore().getAccessToken) return;
    const version = learningSessionVersion();
    loading.value = true;
    failed.value = false;
    try {
      if (!pending && (!cached || Date.now() - cached.at > 30000)) {
        const request = getPronunciationCapabilities();
        pending = request;
        request.then(value => {
          if (isLearningSessionCurrent(version)) cached = { at: Date.now(), value };
        }).catch(() => {}).finally(() => { if (pending === request) pending = null; });
      }
      const value = pending ? await pending : cached!.value;
      if (!disposed && isLearningSessionCurrent(version)) capabilities.value = value;
    } catch {
      if (!disposed && isLearningSessionCurrent(version)) { capabilities.value = null; failed.value = true; }
    } finally { if (!disposed && isLearningSessionCurrent(version)) loading.value = false; }
  }
  const unsubscribe = onLearningSessionChange(() => { capabilities.value = null; loading.value = false; queueMicrotask(() => { if (!disposed) void refresh(); }); });
  onMounted(refresh);
  onScopeDispose(() => { disposed = true; unsubscribe(); });
  return { capabilities, loading, failed, refresh, available: computed(() => capabilities.value?.available === true) };
}
