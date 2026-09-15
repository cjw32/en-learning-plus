import { createPinia, setActivePinia, disposePinia } from 'pinia'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/router', () => ({ default: { replace: vi.fn() } }))
vi.mock('element-plus', () => ({ ElMessage: { error: vi.fn() } }))
vi.mock('@/apis/auth', () => ({ refreshTokenApi: vi.fn() }))
import { useUserStore } from '../user'
import { useCoachStore } from '../coach'
import { usePronunciationStore } from '../pronunciation'
import { aiApi, refreshCoachAccessToken } from '@/apis'
import { refreshTokenApi } from '@/apis/auth'
import { learningSessionVersion } from '@/session/learning-session'
const account = (id: string) => ({ id, token: { accessToken: `${id}-access`, refreshToken: `${id}-refresh` } }) as any
let pinia: ReturnType<typeof createPinia>
beforeEach(() => { pinia = createPinia(); setActivePinia(pinia); useUserStore().setUser(account('alice')) })
afterEach(() => disposePinia(pinia))
describe('account-scoped learning state', () => {
  it('clears profile, history, stream, pending answers and local audio on account replacement', () => {
    const coach = useCoachStore(); const pronunciation = usePronunciationStore()
    coach.profile = { level: 'B1' } as any
    coach.activeConversationId = 'alice-conversation'
    coach.conversations = [{ id: 'alice-conversation' }] as any
    coach.messages = [{ content: 'alice-private-message' }] as any
    coach.beginStream('alice-request'); coach.appendProvisional('alice-private-delta')
    const oldKey = coach.prepareExerciseSubmission('exercise-1', []).idempotencyKey
    pronunciation.assessment = { assessmentId: 'alice-assessment' } as any
    pronunciation.setLocalRecording(new Blob(['audio']), 'blob:alice', 1000)
    useUserStore().setUser(account('bob'))
    expect(coach.profile).toBeNull(); expect(coach.messages).toEqual([])
    expect(coach.conversations).toEqual([]); expect(coach.activeConversationId).toBeNull()
    expect(coach.activeRequestId).toBeNull(); expect(coach.provisionalText).toBe('')
    expect(coach.submissionPending).toBe(false); expect(coach.pendingExerciseId).toBeNull()
    expect(pronunciation.assessment).toBeNull(); expect(pronunciation.getLocalRecording()).toBeNull()
    expect(coach.prepareExerciseSubmission('exercise-1', []).idempotencyKey).not.toBe(oldKey)
    useUserStore().logout(); expect(coach.submissionPending).toBe(false)
  })
  it('does not reset state for token refresh', () => {
    const coach = useCoachStore(); coach.activeConversationId = 'conversation'
    const version = learningSessionVersion()
    useUserStore().updateToken({ accessToken: 'new', refreshToken: 'new-refresh' })
    expect(learningSessionVersion()).toBe(version)
    expect(coach.activeConversationId).toBe('conversation')
  })
  it('rejects delayed API responses from the previous account', async () => {
    let release!: () => void
    const oldAdapter = aiApi.defaults.adapter
    aiApi.defaults.adapter = async config => {
      await new Promise<void>(resolve => { release = resolve })
      return { config, status: 200, statusText: 'OK', headers: {}, data: { data: 'alice-private-profile' } }
    }
    try {
      const pending = aiApi.get('/coach/profile')
      const rejected = expect(pending).rejects.toThrow('Session changed')
      await vi.waitFor(() => expect(release).toBeDefined())
      useUserStore().setUser(account('bob')); release()
      await rejected
    } finally { aiApi.defaults.adapter = oldAdapter }
  })
  it('does not apply a previous account token refresh to the new account', async () => {
    let resolve!: (data: any) => void
    vi.mocked(refreshTokenApi).mockImplementation(() => new Promise(done => { resolve = done }))
    const pending = refreshCoachAccessToken()
    const rejected = expect(pending).rejects.toThrow('Session changed')
    useUserStore().setUser(account('bob'))
    resolve({ success: true, data: { accessToken: 'alice-new', refreshToken: 'alice-new-refresh' } })
    await rejected
    expect(useUserStore().getAccessToken).toBe('bob-access')
  })
})
