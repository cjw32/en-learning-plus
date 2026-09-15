import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia, disposePinia } from 'pinia'
vi.mock('@microsoft/fetch-event-source', () => ({ fetchEventSource: vi.fn() }))
vi.mock('@/apis', () => ({ refreshCoachAccessToken: vi.fn() }))
import { fetchEventSource } from '@microsoft/fetch-event-source'
import { refreshCoachAccessToken } from '@/apis'
import { useUserStore } from '@/stores/user'
import { sse } from '../index'
let pinia: ReturnType<typeof createPinia>
beforeEach(() => {
  pinia = createPinia(); setActivePinia(pinia)
  useUserStore().setUser({ id: 'owner', token: { accessToken: 'access', refreshToken: 'refresh' } } as any)
})
afterEach(() => disposePinia(pinia))
describe('legacy chat streaming transport', () => {
  it('authenticates requests and retries a 401 only after one token refresh', async () => {
    vi.mocked(fetchEventSource).mockImplementationOnce(async (_url, options) => {
      await options!.onopen!(new Response('', { status: 401 }))
    }).mockResolvedValueOnce(undefined)
    vi.mocked(refreshCoachAccessToken).mockImplementation(async () => {
      useUserStore().updateToken({ accessToken: 'new', refreshToken: 'new-refresh' }); return 'new'
    })
    const signal = new AbortController().signal
    await sse('/chat', 'POST', { content: 'hello' }, undefined, undefined, signal)
    expect(fetchEventSource).toHaveBeenCalledTimes(2)
    expect(vi.mocked(fetchEventSource).mock.calls[0]![1]).toMatchObject({ headers: { Authorization: 'Bearer access' }, signal })
    expect(vi.mocked(fetchEventSource).mock.calls[1]![1]).toMatchObject({ headers: { Authorization: 'Bearer new' } })
  })
  it('does not silently replay failed model POSTs', async () => {
    vi.mocked(fetchEventSource).mockImplementationOnce(async (_url, options) => { options!.onerror!(new Error('offline')) })
    await expect(sse('/chat', 'POST', {})).rejects.toThrow('offline')
    expect(fetchEventSource).toHaveBeenCalledTimes(1)
    expect(refreshCoachAccessToken).not.toHaveBeenCalled()
  })
  it('reports explicit server stream errors without replaying the POST', async () => {
    vi.mocked(fetchEventSource).mockImplementationOnce(async (_url, options) => {
      options!.onmessage!({ id: '', event: 'error', data: '{}' })
    })
    await expect(sse('/chat', 'POST', {})).rejects.toThrow('聊天暂时不可用')
    expect(fetchEventSource).toHaveBeenCalledTimes(1)
  })

})
