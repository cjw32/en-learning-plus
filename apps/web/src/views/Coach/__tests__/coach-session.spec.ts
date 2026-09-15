import { shallowMount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia, disposePinia } from 'pinia'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/router', () => ({ default: { push: vi.fn(), replace: vi.fn() } }))
vi.mock('vue-router', () => ({ useRoute: () => ({ query: {} }), useRouter: () => ({ replace: vi.fn() }) }))
vi.mock('@/apis/coach', () => ({
  createCoachConversation: vi.fn(), createCoachRequest: vi.fn(), cancelCoachRequest: vi.fn(),
  getCoachConversation: vi.fn(), getCoachProfile: vi.fn(), getCoachRequest: vi.fn(),
  listCoachConversations: vi.fn(), retryCoachRequest: vi.fn(), updateCoachProfile: vi.fn(), getCoachCitation: vi.fn(),
}))
vi.mock('@/apis/coach/stream', () => ({ openCoachStream: vi.fn() }))
import Coach from '../index.vue'
import CoachComposer from '../components/CoachComposer.vue'
import { getCoachProfile, listCoachConversations, createCoachRequest, createCoachConversation } from '@/apis/coach'
import { openCoachStream } from '@/apis/coach/stream'
import { useUserStore } from '@/stores/user'
import { useCoachStore } from '@/stores/coach'
const account = (id: string) => ({ id, token: { accessToken: id, refreshToken: id } }) as any
let pinia: ReturnType<typeof createPinia>
let wrapper: ReturnType<typeof shallowMount>
beforeEach(() => {
  pinia = createPinia(); setActivePinia(pinia); useUserStore().setUser(account('alice'))
  vi.mocked(getCoachProfile).mockResolvedValue({ data: { level: 'A1' } } as any)
  vi.mocked(listCoachConversations).mockResolvedValue({ data: { items: [] } } as any)
})
afterEach(() => { wrapper?.unmount(); disposePinia(pinia) })
describe('Coach page session lifecycle', () => {
  it('ignores initialization resolving after an account switch', async () => {
    let resolve!: (response: any) => void
    vi.mocked(getCoachProfile).mockImplementationOnce(() => new Promise(done => { resolve = done }))
    wrapper = shallowMount(Coach, { global: { plugins: [pinia] } })
    useUserStore().setUser(account('bob'))
    resolve({ data: { private: 'alice-profile' } })
    await flushPromises()
    expect(useCoachStore().profile).toBeNull()
    expect(useCoachStore().messages).toEqual([])
  })
  it('aborts the stream and ignores late chunks after logout', async () => {
    let finish!: () => void
    vi.mocked(createCoachConversation).mockResolvedValue({ data: { id: 'alice-conversation' } } as any)
    vi.mocked(createCoachRequest).mockResolvedValue({ data: { requestId: 'request_00001', streamUrl: '/events' } } as any)
    vi.mocked(openCoachStream).mockImplementation(() => new Promise(done => { finish = done }))
    wrapper = shallowMount(Coach, { global: { plugins: [pinia] } })
    await flushPromises()
    wrapper.findComponent(CoachComposer).vm.$emit('submit', 'hello')
    await flushPromises()
    const options = vi.mocked(openCoachStream).mock.calls.at(-1)![0]
    expect(options.signal.aborted).toBe(false)
    useUserStore().logout()
    expect(options.signal.aborted).toBe(true)
    options.onEvent({ schemaVersion: 'coach.sse.v1', eventId: 'event_00001', requestId: 'request_00001',
      sequence: 1, timestamp: '2026-09-14T00:00:00Z', type: 'content_delta', payload: { delta: 'alice-private-text' } })
    finish(); await flushPromises()
    expect(useCoachStore().provisionalText).toBe('')
    expect(useCoachStore().messages).toEqual([])
    expect(useCoachStore().error).toBeNull()
  })
})
