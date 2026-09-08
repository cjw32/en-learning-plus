import { createRouter, createWebHistory } from 'vue-router'
import home from './home/index'
import wordBook from './word-book/index'
import setting from './setting/index'
import chat from './chat/index'
import course from './course/index'
import coach from './coach/index'
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
  ],
})

router.beforeEach((to) => {
  const requiresAuth = to.matched.some((record) => record.meta.requiresAuth)
  if (requiresAuth && !useUserStore().getAccessToken) return '/'
  return true
})

export default router
