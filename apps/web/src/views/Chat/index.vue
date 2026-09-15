<template>
  <div class="w-[1200px] mx-auto flex mt-10">
    <Conversations @onGetRole="getRole" />
    <Bubble :list="list" :pending="pending" @onSendMessage="sendMessage" />
  </div>
  <p v-if="error" class="text-center text-red-600" role="alert">{{ error }}</p>
</template>
<script setup lang="ts">
import Conversations from './components/Conversations.vue'
import Bubble from './components/Bubble.vue'
import { onBeforeUnmount, ref } from 'vue'
import { getChatHistory } from '@/apis/chat'
import type { ChatDto, ChatMessage, ChatMessageList, ChatRoleType } from '@en/common/chat'
import { sse, CHAT_URL } from '@/apis/sse'
import { onLearningSessionChange } from '@/session/learning-session'
const role = ref<ChatRoleType>('normal')
const list = ref<ChatMessageList>([])
const pending = ref(false)
const error = ref('')
let generation = 0
let controller: AbortController | null = null
function reset() {
  generation++
  controller?.abort()
  list.value = []
  pending.value = false
  error.value = ''
}
const unsubscribe = onLearningSessionChange(reset)
onBeforeUnmount(() => { reset(); unsubscribe() })
async function getRole(value: ChatRoleType) {
  reset()
  const version = generation
  role.value = value
  pending.value = true
  try {
    const response = await getChatHistory(value)
    if (version === generation) list.value = response.data
  } catch {
    if (version === generation) error.value = '暂时无法读取聊天记录，请重新选择角色。'
  } finally { if (version === generation) pending.value = false }
}
async function sendMessage(content: string, deepThink: boolean, webSearch: boolean) {
  if (pending.value || !content.trim()) return
  const version = generation
  controller = new AbortController()
  pending.value = true
  error.value = ''
  const reply = ref<ChatMessage>({ role: 'ai', content: '', reasoning: '', type: 'chat' })
  list.value.push({ role: 'human', content, type: 'chat' }, reply.value)
  try {
    await sse<ChatMessage, ChatDto>(CHAT_URL, 'POST', { role: role.value, content, deepThink, webSearch },
      (data) => {
        if (version !== generation) return
        if (data.type === 'reasoning') reply.value.reasoning += data.content
        if (data.type === 'chat') reply.value.content += data.content
      }, undefined, controller.signal)
  } catch {
    if (version === generation) error.value = '聊天中断，请检查连接后重新发送。'
  } finally { if (version === generation) pending.value = false }
}
</script>
