<template>
    <div class="w-[1200px] mx-auto mt-10 bg-linear-to-br from-blue-50 to-indigo-50 rounded-[20px] p-20 shadow-lg">
        <div class="h-20">
            <div class="flex items-center gap-2">
                <el-icon color="#2563EB" size="20">
                    <Reading />
                </el-icon>
                <span class="text-2xl font-bold text-gray-800">词库列表</span>
            </div>
            <div class="text-sm text-gray-600">词典来源：牛津、柯林斯、BNC、FRQ、高考、中考、GRE、TOEFL、IELTS、大学英语六级、大学英语四级、考研</div>
        </div>
        <CitedWord />
        <div class="flex items-center mb-10">
            <el-input @keyup.enter="searchWord" class="mr-10" v-model="query.word" placeholder="请输入单词"></el-input>
            <el-checkbox v-model="query.gk">高考</el-checkbox>
            <el-checkbox v-model="query.zk">中考</el-checkbox>
            <el-checkbox v-model="query.gre">GRE</el-checkbox>
            <el-checkbox v-model="query.toefl">TOEFL</el-checkbox>
            <el-checkbox v-model="query.ielts">IELTS</el-checkbox>
            <el-checkbox v-model="query.cet6">六级</el-checkbox>
            <el-checkbox v-model="query.cet4">四级</el-checkbox>
            <el-checkbox v-model="query.ky">考研</el-checkbox>
            <el-button @click="searchWord" class="ml-10" type="primary">搜索</el-button>
        </div>
        <div class="grid grid-cols-3 gap-2">
            <div class="bg-white hover:bg-blue-50 border border-blue-200 text-gray-800 rounded-[10px] p-4 cursor-pointer transition-all duration-200 shadow-sm hover:shadow-md h-[220px]"
                v-for="item in list" :key="item.id">
                <div class="">
                    <div class="text-sm font-semibold text-blue-600 mb-1">{{ item.word }}</div>
                    <div class="text-sm text-gray-500 mb-1 flex items-center gap-2">{{ item.phonetic }} <el-icon
                            size="18" color="#2563EB" @click="playAudio(item.word)">
                            <VideoPlay />
                        </el-icon></div>
                    <div class="text-sm text-gray-700 mb-1 overflow-hidden line-clamp-2">{{ item.definition }}</div>
                    <div v-html="item.translation" class="text-sm text-gray-600 mb-1 overflow-hidden line-clamp-2">
                    </div>
                    <div class="text-sm text-gray-600 mt-3 flex items-center gap-2 flex-wrap">
                        <el-tag v-if="item.gk" type="primary" size="small">高考</el-tag>
                        <el-tag v-if="item.zk" type="primary" size="small">中考</el-tag>
                        <el-tag v-if="item.gre" type="primary" size="small">GRE</el-tag>
                        <el-tag v-if="item.toefl" type="primary" size="small">TOEFL</el-tag>
                        <el-tag v-if="item.ielts" type="primary" size="small">IELTS</el-tag>
                        <el-tag v-if="item.cet6" type="primary" size="small">六级</el-tag>
                        <el-tag v-if="item.cet4" type="primary" size="small">四级</el-tag>
                        <el-tag v-if="item.ky" type="primary" size="small">考研</el-tag>
                    </div>
                    <PronunciationEntry
                        class="mt-3"
                        compact
                        :enabled="pronunciationCaptureEnabled"
                        :target="{ sourceType: 'WORD_BOOK', wordId: item.id }"
                    />
                </div>
            </div>
            <el-pagination class="mt-10" background v-model:current-page="query.page" v-model:page-size="query.pageSize"
                :total="total" @current-change="getList" @size-change="getList" />
        </div>
    </div>
</template>
<script setup lang="ts">
import CitedWord from '@/components/Citation/CitedWord.vue'
import { getWordBookList }from '@/apis/word-book/index'
import { onMounted,ref  } from 'vue'
import { Reading, VideoPlay } from '@element-plus/icons-vue'
import type { WordQuery, WordList } from '@en/common/word'
import { useAudio } from '@/hooks/useAudio'
import PronunciationEntry from '@/components/Pronunciation/PronunciationEntry.vue'
import { usePronunciationCapabilities } from '@/hooks/usePronunciationCapabilities'

const { available: pronunciationCaptureEnabled } = usePronunciationCapabilities()

const { playAudio } = useAudio({
    rate: 0.7,
    pitch: 1,
    volume: 1,
    lang: 'en-US'
})
const total = ref<WordList['total']>(0)
const list = ref<WordList['list']>([])
const query = ref<WordQuery>({  
    page: 1,
    pageSize: 12,
    word: '',
    gk: false,
    zk: false,
    gre: false,
    toefl: false,
    ielts: false,
    cet6: false,
    cet4: false,
    ky: false,
 })
const getList = async () => {
    const res = await getWordBookList(query.value)
    if(res.success) {
        total.value = res.data.total
        list.value = res.data.list
    }
    console.log(res)
}
const searchWord = () => {
    query.value.page = 1
    getList()
}
onMounted(() => {
    getList()
})
</script>
