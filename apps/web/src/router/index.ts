import { createRouter, createWebHistory } from 'vue-router'
import home from './home/index'
import wordBook from './word-book/index'
import setting from './setting/index'
import chat from './chat/index'
import course from './course/index'
import coach from './coach/index'
import mcp, {
  MCP_CONFIRMATION_ROUTE_NAME,
  confirmationSelectorFromRoute,
} from './mcp/index'
import { useUserStore } from '@/stores/user'
const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    ...home,//主页
    ...wordBook,//单词本
    ...setting,//设置
    ...chat,//聊天
    ...course,//课程
    ...coach,//个性化学习 Coach
    ...mcp,//MCP 写操作确认
  ],
})

export function routeAuthenticationGuard(to: Parameters<typeof confirmationSelectorFromRoute>[0] & {
  matched: Array<{ meta: Record<string, unknown> }>
  name?: unknown
}) {
  const requiresAuth = to.matched.some((record) => record.meta.requiresAuth)
  if (requiresAuth && !useUserStore().getAccessToken) {
    if (to.name === MCP_CONFIRMATION_ROUTE_NAME) {
      const selector = confirmationSelectorFromRoute(to)
      return selector
        ? {
            path: '/',
            query: { reauth: 'mcp-confirmation', selector },
          }
        : '/'
    }
    return '/'
  }
  return true
}

router.beforeEach(routeAuthenticationGuard)

export default router
