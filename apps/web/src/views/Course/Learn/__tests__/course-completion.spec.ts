import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia, disposePinia } from 'pinia'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('vue-router', () => ({ useRoute: () => ({ params: { courseId: 'course', title: 'Course' } }), onBeforeRouteLeave: vi.fn() }))
vi.mock('@/hooks/useAudio', () => ({ useAudio: () => ({ playAudio: vi.fn() }) }))
vi.mock('@/apis/learn', () => ({ getWordList: vi.fn(), saveWordMaster: vi.fn() }))
vi.mock('element-plus', () => ({ ElMessage: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }))
import { getWordList, saveWordMaster } from '@/apis/learn'
import { useUserStore } from '@/stores/user'
import Learn from '../index.vue'
let pinia: ReturnType<typeof createPinia>
let wrapper: ReturnType<typeof mount>
const result = { success: true, data: { wordNumber: 1 }, message: 'saved' } as any
beforeEach(() => {
  pinia = createPinia(); setActivePinia(pinia)
  useUserStore().setUser({ id: 'user', wordNumber: 0, token: {} } as any)
  vi.mocked(getWordList).mockResolvedValue({ success: true, data: [{ id: 'word', word: 'a' }] } as any)
  vi.mocked(saveWordMaster).mockResolvedValue(result)
})
afterEach(() => { wrapper?.unmount(); disposePinia(pinia) })
async function complete() {
  wrapper = mount(Learn, { global: { plugins: [pinia], stubs: {
    ElButton: { template: '<button :disabled="loading"><slot /></button>', props: ['loading'] },
    ElIcon: true, ElSkeleton: true, ElEmpty: true,
  } } })
  await flushPromises()
  await wrapper.find('input').setValue('a')
  await wrapper.findAll('button').find(button => button.text() === '下一个')!.trigger('click')
  await flushPromises()
}
describe('course completion persistence', () => {
  it('saves the final word immediately and fetching another batch does not save twice', async () => {
    await complete()
    expect(saveWordMaster).toHaveBeenCalledExactlyOnceWith(['word'])
    expect(wrapper.text()).toContain('本组 1 个词已学完')
    expect(wrapper.text()).toContain('学习进度已保存')
    expect(useUserStore().user?.wordNumber).toBe(1)
    await wrapper.findAll('button').find(button => button.text() === '再练一组')!.trigger('click')
    await flushPromises()
    expect(saveWordMaster).toHaveBeenCalledTimes(1)
    expect(getWordList).toHaveBeenCalledTimes(2)
  })
  it('retains completed IDs on failure and retries without claiming success', async () => {
    vi.mocked(saveWordMaster).mockRejectedValueOnce(new Error('offline'))
    await complete()
    expect(wrapper.text()).toContain('保存失败')
    expect(wrapper.text()).not.toContain('再练一组')
    expect(useUserStore().user?.wordNumber).toBe(0)
    await wrapper.findAll('button').find(button => button.text() === '重试保存')!.trigger('click')
    await flushPromises()
    expect(saveWordMaster).toHaveBeenNthCalledWith(2, ['word'])
    expect(wrapper.text()).toContain('学习进度已保存')
  })
})
