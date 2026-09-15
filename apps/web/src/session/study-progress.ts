export const STUDY_PROGRESS_EVENT = 'learning-progress-saved'
export function notifyStudyProgress() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(STUDY_PROGRESS_EVENT))
}
