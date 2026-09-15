import { learningSessionVersion, assertLearningSession, isLearningSessionCurrent, onLearningSessionChange } from '@/session/learning-session'
import axios, {
  type AxiosError,
  type AxiosInstance,
  type InternalAxiosRequestConfig,
} from 'axios'
import { useUserStore } from '@/stores/user'
import router from '@/router'
import { refreshTokenApi } from './auth'
import { ElMessage } from 'element-plus'

export const uploadUrl = import.meta.env.VITE_MINIO_ENDPOINT
export const socketUrl = import.meta.env.VITE_SOCKET_URL
export const timeout = 50000

export const serverApi = axios.create({
  baseURL: '/api/v1',
  timeout,
})

export const aiApi = axios.create({
  baseURL: '/ai/v1',
  timeout,
})

type RetriableRequestConfig = InternalAxiosRequestConfig & {
  _accessTokenRetried?: boolean
  _sessionVersion?: number
}

let refreshPromise: Promise<string> | null = null
onLearningSessionChange(() => { refreshPromise = null })

function expireSession() {
  const userStore = useUserStore()
  userStore.logout()
  ElMessage.error('登录已过期,请重新登录')
  void router.replace('/')
}

export async function refreshCoachAccessToken(): Promise<string> {
  const userStore = useUserStore()
  const version = learningSessionVersion()
  const refreshToken = userStore.getRefreshToken
  if (!refreshToken) throw new Error('Missing refresh token')
  const result = await refreshTokenApi({ refreshToken })
  assertLearningSession(version)
  if (!result.success || !result.data?.accessToken || !result.data?.refreshToken) throw new Error('Refresh token rejected')
  userStore.updateToken(result.data)
  return result.data.accessToken
}

function installAuthenticatedInterceptors(instance: AxiosInstance) {
  instance.interceptors.request.use((config) => {
    const request = config as RetriableRequestConfig
    request._sessionVersion ??= learningSessionVersion()
    assertLearningSession(request._sessionVersion)
    const accessToken = useUserStore().getAccessToken
    if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`
    return config
  })

  instance.interceptors.response.use(
    (response) => {
      assertLearningSession((response.config as RetriableRequestConfig)._sessionVersion!)
      return response.data
    },
    async (error: AxiosError) => {
      const version = (error.config as RetriableRequestConfig | undefined)?._sessionVersion
      if (version !== undefined) assertLearningSession(version)
      if (error.code === 'ERR_NETWORK') {
        ElMessage.error('网络连接失败,请重试')
        return Promise.reject(error)
      }
      if (error.response?.status !== 401) {
        ElMessage.error('服务器异常,请稍后再试')
        return Promise.reject(error)
      }

      const originalRequest = error.config as
        | RetriableRequestConfig
        | undefined
      const userStore = useUserStore()
      if (
        !originalRequest ||
        originalRequest._accessTokenRetried ||
        !userStore.getAccessToken ||
        !userStore.getRefreshToken
      ) {
        expireSession()
        return Promise.reject(error)
      }
      originalRequest._accessTokenRetried = true

      try {
        if (!refreshPromise) refreshPromise = refreshCoachAccessToken()
        const accessToken = await refreshPromise
        originalRequest.headers.Authorization = `Bearer ${accessToken}`
        return instance(originalRequest)
      } catch (refreshError) {
        if (version === undefined || isLearningSessionCurrent(version)) expireSession()
        return Promise.reject(refreshError)
      } finally {
        if (version === undefined || isLearningSessionCurrent(version)) refreshPromise = null
      }
    },
  )
}

installAuthenticatedInterceptors(serverApi)
installAuthenticatedInterceptors(aiApi)

export interface Response<T = unknown> {
  timestamp: string
  path: string
  message: string
  code: number
  success: boolean
  data: T
}

export * from './mcp'
