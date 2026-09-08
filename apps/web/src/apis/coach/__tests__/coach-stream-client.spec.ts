import { describe, expect, it, vi } from 'vitest'
import type { CoachSseEvent } from '@en/common/coach'
import {
  openCoachStream,
  type CoachStreamDependencies,
} from '@/apis/coach/stream'

function dependencies(
  fetchImpl: CoachStreamDependencies['fetchEventSource'],
): CoachStreamDependencies {
  return {
    fetchEventSource: fetchImpl,
    getAccessToken: () => 'access-token',
    refreshAccessToken: vi.fn(async () => 'refreshed-token'),
  }
}

const connected: CoachSseEvent = {
  schemaVersion: 'coach.sse.v1',
  eventId: 'event_00001',
  requestId: 'request_00001',
  sequence: 0,
  timestamp: '2026-09-02T00:00:00.000Z',
  type: 'connected',
  payload: { status: 'QUEUED', replayedThrough: null },
}

describe('Coach authenticated SSE client', () => {
  it('uses Authorization, AbortSignal and Last-Event-ID without query tokens', async () => {
    const onEvent = vi.fn()
    const abort = new AbortController()
    const fetchImpl = vi.fn(async (_url: string, options: any) => {
      await options.onopen(new Response(null, { status: 200 }))
      options.onmessage({ data: JSON.stringify(connected) })
    })
    await openCoachStream(
      {
        streamUrl: '/ai/v1/coach/requests/request_00001/events',
        signal: abort.signal,
        lastEventId: 'event_00000',
        onEvent,
        onReplayExpired: vi.fn(),
      },
      dependencies(fetchImpl),
    )
    expect(fetchImpl).toHaveBeenCalledWith(
      '/ai/v1/coach/requests/request_00001/events',
      expect.objectContaining({
        signal: abort.signal,
        headers: {
          Authorization: 'Bearer access-token',
          'Last-Event-ID': 'event_00000',
        },
      }),
    )
    expect(fetchImpl.mock.calls[0]![0]).not.toContain('token')
    expect(onEvent).toHaveBeenCalledWith(connected)
  })

  it('refreshes a 401 exactly once and reconnects with the new access token', async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementationOnce(async (_url, options) => {
        await options.onopen(new Response(null, { status: 401 }))
      })
      .mockImplementationOnce(async (_url, options) => {
        await options.onopen(new Response(null, { status: 200 }))
      })
    const deps = dependencies(fetchImpl)
    await openCoachStream(
      {
        streamUrl: '/ai/v1/coach/requests/request_00001/events',
        signal: new AbortController().signal,
        onEvent: vi.fn(),
        onReplayExpired: vi.fn(),
      },
      deps,
    )
    expect(deps.refreshAccessToken).toHaveBeenCalledTimes(1)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(fetchImpl.mock.calls[1]![1].headers.Authorization).toBe(
      'Bearer refreshed-token',
    )
  })

  it('uses durable reconciliation on 410 and does not create or retry a request', async () => {
    const onReplayExpired = vi.fn(async () => undefined)
    const fetchImpl = vi.fn(async (_url: string, options: any) => {
      await options.onopen(new Response(null, { status: 410 }))
    })
    await openCoachStream(
      {
        streamUrl: '/ai/v1/coach/requests/request_00001/events',
        signal: new AbortController().signal,
        onEvent: vi.fn(),
        onReplayExpired,
      },
      dependencies(fetchImpl),
    )
    expect(onReplayExpired).toHaveBeenCalledTimes(1)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
