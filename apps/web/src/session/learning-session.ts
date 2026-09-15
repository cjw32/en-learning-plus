// A generation changes on logout/account replacement, but not token refresh.
let generation = 0
const listeners = new Set<() => void>()
export const learningSessionVersion = () => generation
export const isLearningSessionCurrent = (version: number) => version === generation
export function assertLearningSession(version: number) {
  if (!isLearningSessionCurrent(version)) throw new DOMException('Session changed', 'AbortError')
}
export function onLearningSessionChange(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function invalidateLearningSession() {
  generation++
  for (const listener of listeners) listener()
}
