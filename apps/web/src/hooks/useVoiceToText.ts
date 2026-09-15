import { ref, onBeforeUnmount } from 'vue'
export interface Options {
  lang?: string
  continuous?: boolean
  interimResults?: boolean
  maxAlternatives?: number
}
export const useVoiceToText = (options: Options) => {
  const isRecording = ref(false)
  const Speech = window.SpeechRecognition || window.webkitSpeechRecognition
  const supported = Boolean(Speech)
  let recognition: SpeechRecognition | null = null
  const start = (callback: (result: string) => void) => {
    if (!Speech || isRecording.value) return
    recognition ??= new Speech()
    Object.assign(recognition, { lang: 'zh-CN', continuous: false, interimResults: false, maxAlternatives: 1, ...options })
    recognition.onend = () => { isRecording.value = false }
    recognition.onerror = () => { isRecording.value = false }
    recognition.onresult = (event) => {
      callback(Array.from(event.results).map((result) => result[0]?.transcript ?? '').join(''))
    }
    recognition.start()
    isRecording.value = true
  }
  const stop = () => { recognition?.stop(); isRecording.value = false }
  onBeforeUnmount(() => { if (recognition) { recognition.onresult = null; recognition.abort() } })
  return { isRecording, supported, start, stop }
}
