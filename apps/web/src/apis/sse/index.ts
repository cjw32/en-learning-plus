import { fetchEventSource } from '@microsoft/fetch-event-source'
import type { Method } from 'axios'
import { useUserStore } from '@/stores/user'
import { refreshCoachAccessToken } from '@/apis'
import { learningSessionVersion, assertLearningSession } from '@/session/learning-session'
export const CHAT_URL = '/ai/v1/chat'
export async function sse<T, V>(url: string, method: Method, body: V,
  callback?: (data: T) => void, errorCallback?: (error: Error) => void, signal?: AbortSignal) {
  const version = learningSessionVersion()
  let refreshed = false
  while (!signal?.aborted) {
    assertLearningSession(version)
    let unauthorized = false
    try {
      await fetchEventSource(url, {
        method, signal, openWhenHidden: true,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${useUserStore().getAccessToken ?? ''}` },
        body: JSON.stringify(body),
        async onopen(response) {
          unauthorized = response.status === 401
          if (!response.ok || !response.headers.get('content-type')?.startsWith('text/event-stream')) {
            throw new Error('聊天连接失败')
          }
        },
        onmessage(event) {
          assertLearningSession(version)
          if (event.event === 'error') throw new Error('聊天暂时不可用，请稍后重试')
          if (!signal?.aborted && event.data) callback?.(JSON.parse(event.data) as T)
        },
        // Replaying a POST can repeat model execution. Only retry an unauthenticated request once.
        onerror(error) { throw error },
      })
      return
    } catch (error) {
      assertLearningSession(version)
      if (signal?.aborted) return
      if (unauthorized && !refreshed) {
        refreshed = true
        await refreshCoachAccessToken()
        continue
      }
      errorCallback?.(error as Error)
      throw error
    }
  }
}
