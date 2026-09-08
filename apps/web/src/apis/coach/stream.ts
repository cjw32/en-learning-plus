import {
  fetchEventSource,
  type FetchEventSourceInit,
} from '@microsoft/fetch-event-source'
import { coachSseEventSchema, type CoachSseEvent } from '@en/common/coach'
import { refreshCoachAccessToken } from '@/apis'
import { useUserStore } from '@/stores/user'

class CoachStreamHttpError extends Error {
  constructor(readonly status: number) {
    super(`Coach stream HTTP ${status}`)
  }
}

export type CoachStreamDependencies = {
  fetchEventSource: (
    input: string,
    init: FetchEventSourceInit,
  ) => Promise<void>
  getAccessToken: () => string | undefined
  refreshAccessToken: () => Promise<string>
}

export type OpenCoachStreamOptions = {
  streamUrl: string
  signal: AbortSignal
  lastEventId?: string
  onEvent: (event: CoachSseEvent) => void
  onReplayExpired: () => Promise<void> | void
}

function productionDependencies(): CoachStreamDependencies {
  return {
    fetchEventSource,
    getAccessToken: () => useUserStore().getAccessToken,
    refreshAccessToken: refreshCoachAccessToken,
  }
}

async function connect(
  options: OpenCoachStreamOptions,
  dependencies: CoachStreamDependencies,
  accessToken: string,
) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
  }
  if (options.lastEventId) headers['Last-Event-ID'] = options.lastEventId
  await dependencies.fetchEventSource(options.streamUrl, {
    method: 'GET',
    headers,
    signal: options.signal,
    openWhenHidden: true,
    async onopen(response) {
      if (!response.ok) throw new CoachStreamHttpError(response.status)
    },
    onmessage(message) {
      const parsed = coachSseEventSchema.safeParse(JSON.parse(message.data))
      if (!parsed.success) throw new Error('Invalid Coach stream event')
      options.onEvent(parsed.data)
    },
    onerror(error) {
      if (error instanceof CoachStreamHttpError) throw error
      return 1000
    },
  })
}

export async function openCoachStream(
  options: OpenCoachStreamOptions,
  dependencies: CoachStreamDependencies = productionDependencies(),
) {
  const initialToken = dependencies.getAccessToken()
  if (!initialToken) throw new CoachStreamHttpError(401)
  try {
    await connect(options, dependencies, initialToken)
  } catch (error) {
    if (error instanceof CoachStreamHttpError && error.status === 410) {
      await options.onReplayExpired()
      return
    }
    if (error instanceof CoachStreamHttpError && error.status === 401) {
      const refreshed = await dependencies.refreshAccessToken()
      try {
        await connect(options, dependencies, refreshed)
        return
      } catch (retryError) {
        if (
          retryError instanceof CoachStreamHttpError &&
          retryError.status === 410
        ) {
          await options.onReplayExpired()
          return
        }
        throw retryError
      }
    }
    throw error
  }
}
