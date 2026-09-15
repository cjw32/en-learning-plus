<template>
  <el-config-provider :locale="zhCn">
    <RouterView :key="userStore.user?.id ?? 'anonymous'" />
    <Search />
    <Login />
  </el-config-provider>
</template>
<script setup lang="ts">
import { RouterView } from 'vue-router'
import { defineAsyncComponent, provide, ref, watch } from 'vue'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
// 懒加载 Login 和 Search（首屏不需要，按需加载）
const Search = defineAsyncComponent(() => import('@/components/Search/index.vue'))
const Login = defineAsyncComponent(() => import('@/components/Login/index.vue'))
import { IS_SHOW_LOGIN } from '@/components/Login/type'
provide(IS_SHOW_LOGIN, ref(false))
import { useUserStore } from './stores/user'
import { useSocket } from './hooks/userSocket'
import { Tracker} from '@en/tracker'
const tracker = new Tracker({
  baseUrl:'/api/v1',
  uv:{
    api: '/tracker/uv',
    updateApi:'/tracker/update-uv'
  },
  pv:{
    api:'/tracker/pv'
  },
  event:{
    api:'/tracker/event'
  },
  error:{
    api:'/tracker/error'
  },
  performance:{
    api:'/tracker/performance'
  }
})
const userStore = useUserStore()
const { connect, disconnect } = useSocket()
watch(() => userStore.user?.id, (newVal) => {
  if (newVal) {
    tracker.setUserId(newVal)
    connect()
  } else { 
    disconnect()
  }
},{
  immediate: true
})
</script>
