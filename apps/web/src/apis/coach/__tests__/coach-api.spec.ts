import type {
  AxiosAdapter,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from 'axios'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/router', () => ({ default: { replace: vi.fn() } }))
vi.mock('element-plus', () => ({ ElMessage: { error: vi.fn() } }))
vi.mock('@/apis/auth', () => ({ refreshTokenApi: vi.fn() }))

import { refreshTokenApi } from '@/apis/auth'
import { aiApi } from '@/apis'
import { createCoachRequest, getCoachProfile } from '@/apis/coach'
import { useUserStore } from '@/stores/user'

function response(
  config: InternalAxiosRequestConfig,
  data: unknown,
  status = 200,
): AxiosResponse {
  return {
    config,
    data,
    status,
    statusText: status === 200 ? 'OK' : 'ERROR',
    headers: {},
  }
}

function unauthorized(config: InternalAxiosRequestConfig) {
  return Promise.reject({
    code: 'ERR_BAD_RESPONSE',
    config,
    response: response(config, {}, 401),
  })
}

describe('Coach API authentication and identity boundary', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useUserStore().setUser({
      id: 'user-a',
      name: 'Learner',
      phone: '10000000000',
      wordNumber: 0,
      dayNumber: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      token: { accessToken: 'old-access', refreshToken: 'refresh-a' },
    })
  })

  it('sends the access token and never serializes a userId', async () => {
    let captured: InternalAxiosRequestConfig | undefined
    aiApi.defaults.adapter = (async (config) => {
      captured = config
      return response(config, {
        success: true,
        data: {
          requestId: 'request_00001',
          conversationId: 'conversation-a',
          status: 'QUEUED',
          streamUrl: '/ai/v1/coach/requests/request_00001/events',
          traceId: 'trace_web_00001',
        },
      })
    }) as AxiosAdapter

    await createCoachRequest(
      'conversation-a',
      { type: 'MESSAGE', message: 'Explain went.' },
      'request-key-0001',
    )

    expect(captured?.headers.Authorization).toBe('Bearer old-access')
    expect(JSON.parse(String(captured?.data))).toEqual({
      type: 'MESSAGE',
      message: 'Explain went.',
    })
    expect(String(captured?.data)).not.toContain('userId')
  })

  it('refreshes a 401 once and retries the AI request with the new token', async () => {
    vi.mocked(refreshTokenApi).mockResolvedValue({
      success: true,
      data: { accessToken: 'new-access', refreshToken: 'refresh-b' },
    } as never)
    const authorizations: unknown[] = []
    let attempts = 0
    aiApi.defaults.adapter = (async (config) => {
      attempts += 1
      authorizations.push(config.headers.Authorization)
      if (attempts === 1) return unauthorized(config)
      return response(config, {
        success: true,
        data: {
          cefrLevel: null,
          levelSource: null,
          goalType: null,
          goalText: null,
          activeCourseId: null,
          timezone: 'Asia/Shanghai',
          updatedAt: '1970-01-01T00:00:00.000Z',
        },
      })
    }) as AxiosAdapter

    await getCoachProfile()

    expect(refreshTokenApi).toHaveBeenCalledTimes(1)
    expect(attempts).toBe(2)
    expect(authorizations).toEqual(['Bearer old-access', 'Bearer new-access'])
    expect(useUserStore().getAccessToken).toBe('new-access')
  })

  it('does not enter a refresh loop when the retried request is also 401', async () => {
    vi.mocked(refreshTokenApi).mockResolvedValue({
      success: true,
      data: { accessToken: 'new-access', refreshToken: 'refresh-b' },
    } as never)
    let attempts = 0
    aiApi.defaults.adapter = (async (config) => {
      attempts += 1
      return unauthorized(config)
    }) as AxiosAdapter

    await expect(getCoachProfile()).rejects.toBeTruthy()
    expect(refreshTokenApi).toHaveBeenCalledTimes(1)
    expect(attempts).toBe(2)
  })
})
