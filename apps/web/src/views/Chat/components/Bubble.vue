<template>
    <div class="flex-1 h-[750px] p-5 bg-purple-50 flex flex-col">
        <div class="flex-1 overflow-y-auto">
            <div v-for="(item, index) in list" :key="index">
                <div class="flex justify-end items-center  gap-4 mt-5 mb-5 mr-5" v-if="item.role === 'human'">
                    <div class="text-sm text-white max-w-[80%] rounded-lg p-2 bg-blue-500 shadow-md">
                        {{ item.content }}
                    </div>
                    <div>
                        <el-avatar :size="35">user</el-avatar>
                    </div>
                </div>
                <div class="flex justify-start items-center gap-4 mt-5 mb-5" v-else>
                    <div> <el-avatar :size="35">AI</el-avatar></div>
                    <div>
                        <div v-if="item.role === 'ai' && item.reasoning" class="text-[12px] text-gray-500 max-w-[80%] p-2">
                            {{ item.reasoning }}
                        </div>
                        <div v-if="item.role === 'ai' && item.content !== ''"
                            class="text-sm text-gray-700 max-w-[80%] bg-white rounded-lg mt-2 deepseek-markdown"
                            v-html="parseMarkdown(item.content)" />
                    </div>
                </div>
            </div>
            <div ref="chatRef"></div>
        </div>
        <div class="flex p-5 border-t border-gray-200 box-border flex-col gap-3">
            <!-- 功能选项 -->
            <div class="flex items-center gap-3">
                <div class="flex items-center gap-1 px-3 py-1 rounded-full text-xs cursor-pointer transition-all border"
                    :class="deepThink
                        ? 'bg-purple-100 border-purple-400 text-purple-700'
                        : 'bg-gray-100 border-gray-200 text-gray-500 hover:bg-gray-200'"
                    @click="deepThink = !deepThink">
                    <span>🧠</span>
                    <span>深度思考</span>
                </div>
                <div class="flex items-center gap-1 px-3 py-1 rounded-full text-xs cursor-pointer transition-all border"
                    :class="webSearch
                        ? 'bg-blue-100 border-blue-400 text-blue-700'
                        : 'bg-gray-100 border-gray-200 text-gray-500 hover:bg-gray-200'"
                    @click="webSearch = !webSearch">
                    <span>🌐</span>
                    <span>联网搜索</span>
                </div>
            </div>
            <!-- 输入框 -->
            <div class="flex">
                <el-input @keyup.enter="sendMessage" type="textarea" :rows="2" v-model="message" placeholder="请输入内容" />
                <el-button class="ml-2" :disabled="pending" :icon="Position" type="primary" @click="sendMessage"></el-button>
                <el-button v-if="supported && !isRecording" class="ml-2" :icon="Mic" type="primary" @click="startRecording"></el-button>
                <el-button v-else-if="supported" class="ml-2" :icon="VideoPause" type="primary" @click="stopRecording"></el-button>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, useTemplateRef, watch, nextTick } from 'vue'
import { Position, Mic, VideoPause} from '@element-plus/icons-vue'
import type { ChatMessageList } from '@en/common/chat'
import { parseSafeChatMarkdown } from '../safe-chat-markdown'
import '@/assets/css/deep-seek.css'
import { useVoiceToText } from '@/hooks/useVoiceToText'
const deepThink = ref(false)//深度思考
const webSearch = ref(false)//网络搜索
const emits = defineEmits(['onSendMessage'])
const chatRef = useTemplateRef<HTMLDivElement>('chatRef')
const props = defineProps<{ list?: ChatMessageList; pending?: boolean }>()//消息列表
const message = ref<string>('')
const { isRecording, supported, start, stop } = useVoiceToText({
    lang: 'zh-CN',
    continuous: true,
})
//发送消息
const sendMessage = () => {
    if (!message.value.trim() || props.pending) return
    emits('onSendMessage', message.value, deepThink.value, webSearch.value)
    message.value = ''
}
//解析markdown
const parseMarkdown = (content: string) => {
    if (!content) return ''
    return parseSafeChatMarkdown(content)
}
//开始录音
const startRecording = () => {
    start((result) => {
        console.log(result)
        message.value = result
    })
}
 //停止录音
const stopRecording = () => {
    stop()
   sendMessage()
}
watch(() => props.list, () => {
    nextTick(() => {
        chatRef.value?.scrollIntoView({ behavior: 'smooth' })
    })
}, {
    immediate: true,
    deep: true
})

</script>