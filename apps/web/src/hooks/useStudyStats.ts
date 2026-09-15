import { onBeforeUnmount, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { useUserStore } from "@/stores/user";
import { getStudyStats } from "@/apis/learn";
import {
  learningSessionVersion,
  isLearningSessionCurrent,
} from "@/session/learning-session";
import { STUDY_PROGRESS_EVENT } from "@/session/study-progress";
export function useStudyStats() {
  const user = useUserStore();
  const route = useRoute();
  const checkedInToday = ref(false);
  let generation = 0;
  let active = true;
  async function refresh() {
    const epoch = ++generation;
    const subject = user.getUser?.id;
    const version = learningSessionVersion();
    if (!subject) {
      checkedInToday.value = false;
      return;
    }
    try {
      const response = await getStudyStats();
      if (
        !active ||
        epoch !== generation ||
        !isLearningSessionCurrent(version) ||
        subject !== user.getUser?.id
      )
        return;
      const value = response.data;
      if (
        !response.success ||
        !Number.isInteger(value?.dayNumber) ||
        value.dayNumber < 0 ||
        !Number.isInteger(value?.wordNumber) ||
        value.wordNumber < 0 ||
        typeof value.checkedInToday !== "boolean"
      )
        return;
      user.updateStudyStats(value);
      checkedInToday.value = value.checkedInToday;
    } catch {
      /* Keep the last saved totals if a refresh fails. */
    }
  }
  watch(
    () => user.getUser?.id,
    () => {
      checkedInToday.value = false;
      void refresh();
    },
    { immediate: true, flush: "sync" },
  );
  watch(() => route.fullPath, refresh);
  const visible = () => {
    if (document.visibilityState === "visible") void refresh();
  };
  window.addEventListener("focus", refresh);
  window.addEventListener(STUDY_PROGRESS_EVENT, refresh);
  document.addEventListener("visibilitychange", visible);
  onBeforeUnmount(() => {
    active = false;
    generation++;
    window.removeEventListener("focus", refresh);
    window.removeEventListener(STUDY_PROGRESS_EVENT, refresh);
    document.removeEventListener("visibilitychange", visible);
  });
  return { checkedInToday, refresh };
}
