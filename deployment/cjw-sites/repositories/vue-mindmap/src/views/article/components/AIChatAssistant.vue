<template>
  <div class="ai-assistant-container">
    <!-- 聊天主窗口 -->
    <transition name="slide-fade">
      <div v-if="isOpen" class="chat-window">
        <!-- 顶部栏 -->
        <div class="chat-header">
          <div class="header-left">
            <div class="avatar-circle">
              <img style="width: 80%" src="@/assets/img/deepseek.png" />
            </div>
            <div class="header-text">
              <span class="title">AI 学习助教</span>
              <span class="status">DeepSeek V3.2 在线</span>
            </div>
          </div>
          <button class="close-btn" @click="toggleChat">×</button>
        </div>

        <!-- 消息列表区 -->
        <div class="messages-area" ref="messagesRef">
          <div v-if="messages.length === 0" class="welcome-card">
            <p>👋 同学你好！</p>
            <p>
              我是你的专属 AI
              助教。关于文章内容、代码疑惑或数学公式，都可以问我哦！
            </p>
          </div>

          <div
            v-for="(msg, index) in messages"
            :key="index"
            class="message-row"
            :class="msg.role"
          >
            <!-- 头像 -->
            <div class="message-avatar" v-if="msg.role === 'assistant'">
              <img style="width: 80%" src="@/assets/img/deepseek.png" />
            </div>
            <div class="message-avatar user" v-else>🧑‍🎓</div>

            <!-- 气泡 -->
            <div class="message-bubble">
              <div
                v-if="msg.role === 'assistant'"
                class="markdown-body"
                v-html="renderMarkdown(msg.content)"
              ></div>
              <div v-else>{{ msg.content }}</div>
            </div>
          </div>

          <!-- 加载动画 (仅在等待首字时显示) -->
          <div v-if="isLoading" class="message-row assistant">
            <div class="message-avatar">
              <img style="width: 80%" src="@/assets/img/deepseek.png" />
            </div>
            <div class="message-bubble loading">
              <span class="dot"></span><span class="dot"></span
              ><span class="dot"></span>
            </div>
          </div>
        </div>

        <!-- 输入区 -->
        <div class="input-area">
          <textarea
            v-model="inputMsg"
            placeholder="输入你的问题，按 Enter 发送..."
            @keydown.enter.prevent="sendMessage"
            :disabled="isGenerating"
          ></textarea>
          <button
            class="send-btn"
            @click="sendMessage"
            :disabled="isGenerating || !inputMsg.trim()"
          >
            <span v-if="!isGenerating">发送</span>
            <span v-else>停止</span>
          </button>
        </div>
      </div>
    </transition>

    <!-- 悬浮开关按钮 -->
    <button
      class="float-trigger"
      @click="toggleChat"
      :class="{ active: isOpen }"
      title="召唤 AI 助教"
    >
      <span class="trigger-icon" v-if="!isOpen"
        ><img style="width: 70%" src="@/assets/img/deepseek2.png"
      /></span>
      <span class="trigger-icon close" v-else>▼</span>
    </button>
  </div>
</template>

<script setup>
import { ref, nextTick } from "vue";
import { marked } from "marked";

// --- 状态管理 ---
const isOpen = ref(false); // 聊天窗口开启状态
const inputMsg = ref(""); // 用户当前输入
const isLoading = ref(false); // 是否正在等待 API 响应首个字节
const isGenerating = ref(false); // 是否正在接收流式数据
const messagesRef = ref(null); // 消息列表 DOM 引用，用于滚动
const abortController = ref(null); // AbortController 实例，用于中断请求

// 消息历史数组，格式：{ role: 'user' | 'assistant', content: '...' }
const messages = ref([]);

// DeepSeek API 配置
const API_KEY = ""; // Disabled until a protected server-side integration is available.
const API_URL = "https://api.deepseek.com/chat/completions";

/**
 * 切换聊天窗口的显示/隐藏状态
 * 如果打开窗口，自动滚动到底部
 */
const toggleChat = () => {
  isOpen.value = !isOpen.value;
  if (isOpen.value) {
    scrollToBottom();
  }
};

/**
 * 渲染 Markdown 文本
 * @param {string} text - 需要渲染的文本
 * @returns {string} - 渲染后的 HTML
 * 用途：主要用于将 AI 返回的 Markdown 格式答案转换为 HTML 显示
 */
const renderMarkdown = (text) => {
  try {
    return marked.parse(text || ""); // 处理空字符串防止报错
  } catch (e) {
    return text;
  }
};

/**
 * 自动滚动消息列表到底部
 * 用途：发送新消息或接收 AI 回复时调用
 */
const scrollToBottom = async () => {
  await nextTick();
  if (messagesRef.value) {
    messagesRef.value.scrollTop = messagesRef.value.scrollHeight;
  }
};

/**
 * 手动停止生成
 * 功能：
 * 1. 调用 abortController.abort() 中断 fetch 请求
 * 2. 重置 loading 和 generating 状态
 */
const stopGeneration = () => {
  if (abortController.value) {
    abortController.value.abort();
    abortController.value = null;
  }
  isLoading.value = false;
  isGenerating.value = false;
};

/**
 * 核心方法：发送消息并处理流式响应
 * 逻辑流程：
 * 1. 状态检查：如果正在生成，则该动作变为“停止生成”
 * 2. 数据准备：将用户消息加入列表，准备 API payload
 * 3. 请求发起：使用 fetch 发送 POST 请求，开启 stream: true
 * 4. 流式处理：
 * - 获取 reader 读取器
 * - 循环读取数据块 (chunk)
 * - 解析 SSE (Server-Sent Events) 格式数据
 * - 实时将 delta content 追加到最后一条消息中
 * 5. 异常处理：处理网络错误或手动中断 (AbortError)
 */
const sendMessage = async () => {
  // 如果正在生成，点击按钮则为停止
  if (isGenerating.value) {
    stopGeneration();
    return;
  }

  if (!inputMsg.value.trim()) return;

  const userText = inputMsg.value.trim();

  // 1. 添加用户消息到界面
  messages.value.push({ role: "user", content: userText });
  inputMsg.value = "";

  isLoading.value = true;
  isGenerating.value = true;
  scrollToBottom();

  // 初始化 AbortController 用于后续可能的停止操作
  abortController.value = new AbortController();

  try {
    // 2. 准备请求数据 (开启 stream: true 以获得打字机效果)
    const payload = {
      model: "deepseek-chat",
      messages: [
        {
          role: "system",
          content:
            "你是一个乐于助人的计算机与数学学习助手。回答请简洁、专业，可以使用 Markdown 格式（如代码块、公式）。",
        },
        ...messages.value.map((m) => ({ role: m.role, content: m.content })),
      ],
      stream: true,
    };

    // 3. 发起请求
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(payload),
      signal: abortController.value.signal,
    });

    if (!response.ok) {
      // 尝试获取详细的错误信息
      let errorMessage = `API 请求失败: ${response.status}`;
      try {
        const errorData = await response.json();
        if (errorData.error && errorData.error.message) {
          errorMessage = `API 请求失败: ${errorData.error.message}`;
        }
      } catch (e) {
        // 如果无法解析错误响应，使用默认错误信息
      }
      throw new Error(errorMessage);
    }

    // 4. 处理流式响应 (Streams API)
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");

    // 先添加一个空的 AI 消息占位，准备接收数据
    messages.value.push({ role: "assistant", content: "" });
    const currentMsgIndex = messages.value.length - 1;

    // 开始接收数据，隐藏加载动画 (转圈圈)，转为打字机显示
    isLoading.value = false;
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;

      // 处理 SSE 格式数据 (data: {...})
      // 可能一次收到多行，也可能收到半行，需要 buffer 缓冲
      const lines = buffer.split("\n");
      buffer = lines.pop(); // 保留最后一个可能不完整的行到下一次处理

      for (const line of lines) {
        if (line.trim() === "") continue;
        if (line.trim() === "data: [DONE]") continue; // 结束标识

        if (line.startsWith("data: ")) {
          try {
            const jsonStr = line.slice(6); // 去掉 'data: ' 前缀
            const json = JSON.parse(jsonStr);
            const content = json.choices[0]?.delta?.content || "";

            // 逐字追加到当前消息
            messages.value[currentMsgIndex].content += content;
            scrollToBottom();
          } catch (e) {
            console.error("解析流数据失败", e);
          }
        }
      }
    }
  } catch (error) {
    if (error.name === "AbortError") {
      console.log("生成已停止");
    } else {
      console.error("Chat Error:", error);
      // 如果出错时还没生成 AI 消息框，则新建一个显示错误
      if (messages.value[messages.value.length - 1].role !== "assistant") {
        messages.value.push({
          role: "assistant",
          content: `出错啦：${error.message}`,
        });
      } else {
        messages.value[messages.value.length - 1].content +=
          `\n[出错：${error.message}]`;
      }
    }
  } finally {
    // 无论成功还是失败，重置状态
    isLoading.value = false;
    isGenerating.value = false;
    abortController.value = null;
    scrollToBottom();
  }
};
</script>

<style scoped>
/* 容器定位 */
.ai-assistant-container {
  position: fixed;
  bottom: 30px;
  right: 90px;
  z-index: 2000;
  font-family:
    -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial,
    sans-serif;
}

/* 悬浮球按钮 */
.float-trigger {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: linear-gradient(135deg, #5b88e1, #4a75d1);
  border: none;
  box-shadow: 0 4px 15px rgba(91, 136, 225, 0.4);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}

.float-trigger:hover {
  transform: scale(1.1) rotate(10deg);
  box-shadow: 0 6px 20px rgba(91, 136, 225, 0.5);
}

.float-trigger.active {
  transform: rotate(90deg);
  background: #475b6d;
}

.trigger-icon {
  font-size: 28px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 聊天窗口 */
.chat-window {
  position: absolute;
  bottom: 80px;
  right: 0;
  width: 380px;
  height: 550px;
  background: white;
  border-radius: 6px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.15);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid rgba(0, 0, 0, 0.05);
}

/* 头部 */
.chat-header {
  padding: 15px 20px;
  background: #5b88e1;
  color: white;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.avatar-circle {
  width: 32px;
  height: 32px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
}

.header-text {
  display: flex;
  flex-direction: column;
}

.title {
  font-weight: 600;
  font-size: 15px;
}

.status {
  font-size: 11px;
  opacity: 0.8;
}

.close-btn {
  background: none;
  border: none;
  color: white;
  font-size: 24px;
  cursor: pointer;
  padding: 0;
  line-height: 1;
  opacity: 0.8;
}

.close-btn:hover {
  opacity: 1;
}

/* 消息区 */
.messages-area {
  flex: 1;
  padding: 20px;
  overflow-y: auto;
  background: #f8faff;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.welcome-card {
  text-align: center;
  padding: 20px;
  color: #666;
  background: rgba(91, 136, 225, 0.05);
  border-radius: 12px;
  font-size: 14px;
  line-height: 1.6;
}

.message-row {
  display: flex;
  gap: 10px;
  max-width: 100%;
}

.message-row.user {
  flex-direction: row-reverse;
}

.message-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: #eee;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  flex-shrink: 0;
}

.message-avatar.user {
  background: #eef4ff;
}

.message-bubble {
  padding: 12px 16px;
  border-radius: 12px;
  max-width: 80%;
  font-size: 14px;
  line-height: 1.6;
  word-wrap: break-word;
  position: relative;
}

.message-row.assistant .message-bubble {
  background: white;
  border-top-left-radius: 2px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
  color: #333;
}

.message-row.user .message-bubble {
  background: #5b88e1;
  color: white;
  border-top-right-radius: 2px;
}

/* 输入区 */
.input-area {
  padding: 15px;
  background: white;
  border-top: 1px solid #eee;
  display: flex;
  gap: 10px;
  align-items: flex-end;
}

textarea {
  flex: 1;
  border: 1px solid #ddd;
  border-radius: 6px;
  padding: 10px 15px;
  resize: none;
  height: 40px;
  max-height: 100px;
  font-family: inherit;
  font-size: 14px;
  outline: none;
  transition: border-color 0.2s;

  /* 隐藏滚动条 - Firefox */
  scrollbar-width: none;
  /* 隐藏滚动条 - IE 10+ */
  -ms-overflow-style: none;
}

/* 隐藏滚动条 - Chrome/Safari/Edge */
textarea::-webkit-scrollbar {
  display: none;
}

textarea:focus {
  border-color: #5b88e1;
}

.send-btn {
  background: #5b88e1;
  color: white;
  border: none;
  border-radius: 20px;
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  height: 38px;
  transition: background 0.2s;
}

.send-btn:disabled {
  background: #ccc;
  cursor: not-allowed;
}

/* 打字动画 */
.loading .dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  background: #999;
  border-radius: 50%;
  margin: 0 2px;
  animation: bounce 1.4s infinite ease-in-out both;
}

.loading .dot:nth-child(1) {
  animation-delay: -0.32s;
}
.loading .dot:nth-child(2) {
  animation-delay: -0.16s;
}

@keyframes bounce {
  0%,
  80%,
  100% {
    transform: scale(0);
  }
  40% {
    transform: scale(1);
  }
}

/* 动画效果 */
.slide-fade-enter-active,
.slide-fade-leave-active {
  transition: all 0.3s cubic-bezier(1, 0.5, 0.8, 1);
}
.slide-fade-enter-from,
.slide-fade-leave-to {
  transform: translateY(20px) scale(0.95);
  opacity: 0;
}

/* Markdown 样式微调 */
.markdown-body :deep(p) {
  margin: 0 0 8px 0;
}
.markdown-body :deep(p:last-child) {
  margin: 0;
}
.markdown-body :deep(pre) {
  background: #f4f4f4;
  padding: 8px;
  border-radius: 4px;
  overflow-x: auto;
  margin: 8px 0;
}
.markdown-body :deep(code) {
  font-family: monospace;
  font-size: 12px;
  color: #d63384;
}
.message-row.user .markdown-body {
  color: white;
}
</style>
