<template>
    <div class="min-h-[60vh] bg-zinc-50/80">
        <div class="w-[1200px] mx-auto px-4 pt-12 pb-24">
            <header class="mb-10 text-center">
                <h1 class="text-3xl font-bold text-zinc-900 tracking-tight sm:text-4xl">{{ title }}</h1>
                <p class="mt-3 text-zinc-500 text-sm">请根据释义和翻译拼写单词</p>
            </header>

            <el-skeleton v-if="isLoading" :rows="10" animated />

            <div v-if="list.length === 0" class="flex justify-center py-20">
                <el-empty description="暂无单词或您尚未购买该课程" />
            </div>

            <template v-else>
                <!-- 本组已学完 -->
                <div v-if="currentIndex >= list.length"
                    class="text-center py-16 px-6 bg-white rounded-2xl border border-zinc-100 shadow-sm">
                    <p class="text-zinc-600 mb-6">本组 {{ list.length }} 个词已学完</p>
                    <p class="mb-4" role="status">{{ saving ? '正在保存学习进度…' : saved ? '学习进度已保存' : '保存失败，请重试后再离开' }}</p>
                    <el-button v-if="!saved" type="primary" size="large" :loading="saving" @click="saveWordMaster">重试保存</el-button>
                    <el-button v-else type="primary" size="large" :loading="isLoading" @click="nextBatch">再练一组</el-button>
                </div>

                <!-- 当前单词卡片 -->
                <div v-else>
                    <div class="mb-4 flex items-center justify-between text-sm text-zinc-500">
                        <span>第 {{ currentIndex + 1 }} / {{ list.length }} 个</span>
                    </div>
                    <article class="bg-white rounded-2xl border border-zinc-100 shadow-sm overflow-hidden">
                        <div class="p-8 sm:p-10 relative">
                            <div class="flex justify-center mb-6">
                                <div :class="{ 'filter blur-md select-none': isWordBlurred }"
                                    class="transition-all duration-300 min-h-10 flex flex-col items-center text-center">
                                    <div class="text-2xl sm:text-3xl font-bold text-indigo-600 tracking-tight">
                                        {{ currentWord?.word }}
                                    </div>
                                    <div class="flex items-center justify-center gap-2 mt-1">
                                        <span v-if="currentWord?.phonetic" class="text-base text-zinc-500 font-mono">
                                            {{ currentWord.phonetic }}
                                        </span>
                                        <el-icon v-if="currentWord?.word"
                                            class="shrink-0 cursor-pointer text-slate-400 hover:text-indigo-400 transition-colors"
                                            :size="18" title="发音" @click="playAudio(currentWord!.word)">
                                            <VideoPlay />
                                        </el-icon>
                                    </div>
                                </div>
                                <el-icon
                                    class="absolute! right-10 top-10 cursor-pointer text-slate-400 hover:text-indigo-400 transition-colors"
                                    :size="18" :title="isWordBlurred ? '点击显示单词' : '点击隐藏单词'"
                                    @click="isWordBlurred = !isWordBlurred">
                                    <View v-if="isWordBlurred" />
                                    <Hide v-else />
                                </el-icon>
                            </div>
                            <!-- 释义 -->
                            <div class="mb-4 rounded-lg bg-zinc-50/80 border border-zinc-100 p-4">
                                <p class="text-xs font-medium text-zinc-400 uppercase tracking-wide mb-2">释义</p>
                                <div class="text-zinc-700 leading-relaxed prose prose-sm max-w-none"
                                    v-html="currentWord?.definition" />
                            </div>
                            <!-- 翻译 -->
                            <div class="rounded-lg bg-zinc-50/80 border border-zinc-100 p-4">
                                <p class="text-xs font-medium text-zinc-400 uppercase tracking-wide mb-2">翻译</p>
                                <div class="text-zinc-600 leading-relaxed whitespace-pre-line prose prose-sm max-w-none"
                                    v-html="currentWord?.translation" />
                            </div>
                            <!--拼写练习-->
                            <div class="rounded-lg bg-zinc-50/80 border border-zinc-100 p-4">
                                <p class="text-xs font-medium text-zinc-400 uppercase tracking-wide mb-2">拼写</p>
                                <div class="flex items-center gap-2 justify-center">
                                    <input :maxlength="1" ref="inputRefs" @input="onInput(index)" v-for="(item, index) in wordList"
                                        @keydown="onKeyDown(index, $event)" :key="index" type="text" v-model="item.input"
                                        :class="{ 'border-indigo-500!': item.isTrue === true, 'border-red-500!': item.isTrue === false }"
                                        class="border-0 border-b-2 border-zinc-300 focus:border-indigo-500 bg-transparent outline-none w-10 text-center text-2xl font-bold" />
                                </div>
                            </div>
                            <!--控制按钮-->
                            <div class="flex justify-end gap-2">
                                <el-button type="primary" @click="pagePrev">
                                    上一个
                                </el-button>
                                <el-button type="primary" @click="pageNext">
                                    下一个
                                </el-button>
                            </div>
                        </div>
                    </article>
                </div>
            </template>
        </div>
    </div>
</template>

<script setup lang="ts">
import { notifyStudyProgress } from '@/session/study-progress';
import { useAudio } from '@/hooks/useAudio';
import type { Word } from '@en/common/word';
import { computed, nextTick, onMounted, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue';
import { useRoute, onBeforeRouteLeave } from 'vue-router';
import { VideoPlay, View, Hide } from '@element-plus/icons-vue';
import { getWordList, saveWordMaster as saveWordMasterApi } from '@/apis/learn';
import { ElMessage } from 'element-plus';
import { useUserStore } from '@/stores/user';
import { learningSessionVersion, isLearningSessionCurrent } from '@/session/learning-session';
const sessionVersion = learningSessionVersion();
let disposed = false;
onBeforeUnmount(() => { disposed = true; });
const isCurrentSession = () => !disposed && isLearningSessionCurrent(sessionVersion);
interface WordItem {
    word: string;
    input: string;
    isTrue: boolean | undefined;
}

const inputRefs = useTemplateRef<HTMLInputElement[]>('inputRefs')
const {playAudio} = useAudio({})//发音的api
const route = useRoute();
const title = route.params.title || '我的课程';
const isLoading = ref(false);//默认不加载
const list = ref<Word[]>([]);//单词列表
const saving = ref(false);
const saved = ref(false);
const currentIndex = ref(0);//当前索引
const isWordBlurred = ref(true);//是否隐藏单词
const currentWord = computed<Word | undefined>(() => list.value[currentIndex.value]);//当前单词
const wordList = ref<WordItem[]>([]);//拼写列表
const userStore =  useUserStore()
watch(currentWord, () => {
    isWordBlurred.value = true;
    const current = currentWord.value?.word || '';//读取当前单词
     wordList.value =  Array.from(current).map((item) => {
        return {
            word:item,
            input:'',
            isTrue:undefined
        }
    })
}, { immediate: true })


//上一个
const pagePrev = () => {
    if(currentIndex.value <= 0)return
    currentIndex.value--
}

//下一个
const pageNext = async () => {
    if (saving.value || currentIndex.value >= list.value.length) return
    if(wordList.value.some(item => !item.isTrue)){
        ElMessage.warning('请完成当前单词的拼写')
        return
    }
    currentIndex.value++
    if (currentIndex.value === list.value.length) await saveWordMaster()
}

//保存的方法
const saveWordMaster = async () => {
    if (saving.value || saved.value || !list.value.length) return;
    saving.value = true;
    try {
        const res = await saveWordMasterApi(list.value.map(item => item.id));
        if (!isCurrentSession()) return;
        if (!res.success || typeof res.data?.wordNumber !== 'number') throw new Error('保存失败');
        userStore.updateUserWordNumber(res.data.wordNumber);
        if (typeof res.data.dayNumber === 'number') userStore.updateStudyStats({wordNumber:res.data.wordNumber,dayNumber:res.data.dayNumber});
        notifyStudyProgress();
        saved.value = true;
        ElMessage.success('学习进度已保存');
    } catch {
        if (isCurrentSession()) ElMessage.error('学习进度尚未保存，请重试');
    } finally { saving.value = false; }
}
const nextBatch = async () => {
    if (!saved.value || isLoading.value) return;
    await getWordListData();
}
onBeforeRouteLeave(() => {
    if (list.value.length && currentIndex.value >= list.value.length && !saved.value) {
        ElMessage.warning(saving.value ? '正在保存，请稍候' : '请先重试保存学习进度');
        return false;
    }
})

//输入的方法
const onInput = (index: number) => {
    const current = wordList.value[index];
    current!.isTrue = current!.word === current!.input;
    nextTick(() => {
        const inputs = inputRefs.value as HTMLInputElement[];
        if(index < inputs.length - 1){//不是最后一个
            inputs[index + 1]!.focus()//下一个输入框获取焦点
        }
    })
}

//按键的方法
const onKeyDown = (index: number, event: KeyboardEvent) => {
    if(event.key === 'Backspace'){
        event.preventDefault();
        const current = wordList.value[index];
        current!.input = ''
        current!.isTrue = undefined;
        nextTick(() => {
            const inputs = inputRefs.value as HTMLInputElement[];
            if(index > 0){//不是第一个
                inputs[index - 1]!.focus()//上一个输入框获取焦点
            }
        })
    }
    if(event.key.length == 1 && !event.ctrlKey && !event.metaKey && !event.altKey){
        const current = wordList.value[index];
        if(current?.input && index < wordList.value.length - 1){
            event.preventDefault();
            wordList.value[index + 1]!.input = event.key;
            wordList.value[index + 1]!.isTrue = wordList.value[index + 1]!.word === event.key;
            nextTick(() => {
                const inputs = inputRefs.value as HTMLInputElement[];
                inputs[index + 1]!.focus()//下一个输入框获取焦点
            })
        }
    }
}

const getWordListData = async () => {
    isLoading.value = true;
    try {
    const res = await getWordList(route.params.courseId as string);
    if (!isCurrentSession()) return;
    if(res.success){
        list.value = res.data
        currentIndex.value = 0
        saved.value = false
    }else{
        ElMessage.error(res.message)
    }
    } catch { ElMessage.error('读取单词失败，请重试'); }
    finally { isLoading.value = false; }
}
onMounted(() => {
    getWordListData();
})
</script>