<template>
  <div class="article-container">
    <div class="article-leftContainer">
      <div class="left-title">文章列表</div>
      <el-scrollbar
        max-height="calc(100vh - 120px)"
        class="article-el-scrollbar"
      >
        <router-link
          v-for="item in categoryStore.articleMap[category]"
          :key="item.id"
          class="article-leftItemContainer"
          :to="item.to"
          @click="scrollToTop"
        >
          <span class="article-link-text">{{ item.title }}</span>
        </router-link>
      </el-scrollbar>
    </div>

    <!-- 中间 Markdown 内容 -->
    <div class="article-mainContainerCenterItem">
      <!-- 监听 loaded 事件，内容渲染完后再生成目录 -->
      <MarkdownRender @loaded="generateToc"></MarkdownRender>
    </div>

    <!-- 右侧动态目录 TOC -->
    <div class="article-rightContainer">
      <div class="toc-wrapper" v-if="tocData.length > 0">
        <div class="toc-title">目录</div>
        <ul class="toc-list">
          <li
            v-for="head in tocData"
            :key="head.id"
            :class="{
              active: activeHeaderId === head.id,
              'toc-h2': head.level === 2,
              'toc-h3': head.level === 3,
            }"
            @click.prevent="scrollToHeader(head.id)"
          >
            {{ head.text }}
          </li>
        </ul>
      </div>
    </div>

    <!-- 回到顶部按钮 -->
    <transition name="fade">
      <button v-if="y > 300" @click="scrollToTop" class="back-to-top">↑</button>
    </transition>
  </div>
</template>

<script setup>
import { useRoute } from "vue-router";
import { useCategoryStore } from "@/stores/category";
import MarkdownRender from "./components/MarkdownRender.vue";
import { useScroll } from "@vueuse/core";
import { computed, ref, onUnmounted, nextTick } from "vue";

const { y } = useScroll(window);
const categoryStore = useCategoryStore();
const route = useRoute();

const category = computed(() => route.params.category);
const tocData = ref([]); // 目录结构数据
const activeHeaderId = ref(""); // 当前视口高亮的标题ID
let observer = null; // IntersectionObserver 实例

/**
 * 滚动回顶部
 * 功能：将页面平滑滚动到最顶端
 */
const scrollToTop = () => {
  window.scrollTo({ top: 0, behavior: "smooth" });
};

// ------------------------
// TOC (目录) 核心逻辑
// ------------------------

/**
 * 生成目录并启动监听
 * 功能：
 * 1. 查找 Markdown 容器内的所有 h1, h2, h3 标签
 * 2. 提取标题文本和层级，生成 tocData 数组供右侧渲染
 * 3. 实例化 IntersectionObserver，开始监听标题是否进入视口，以实现目录高亮联动
 * 触发时机：MarkdownRender 组件加载完毕(@loaded)后
 */
const generateToc = () => {
  // 1. 获取所有标题元素
  // 假设 MarkdownRender 内部的容器 class 是 .markdown-container
  const container = document.querySelector(".markdown-container");
  if (!container) return;

  const headers = container.querySelectorAll("h1, h2, h3");
  const toc = [];

  // 清理旧的观察者，防止重复绑定
  if (observer) {
    observer.disconnect();
  }

  // 2. 初始化 IntersectionObserver
  // rootMargin 设置为 "-10% 0px -80% 0px"，意味着当标题进入视口顶部的 10% 区域时触发高亮
  observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          activeHeaderId.value = entry.target.id;
        }
      });
    },
    { rootMargin: "-10% 0px -80% 0px" }
  );

  headers.forEach((h, index) => {
    // 如果没有 ID，手动生成一个，方便锚点跳转
    if (!h.id) {
      h.id = `heading-${index}`;
    }

    // 存入数据
    toc.push({
      id: h.id,
      text: h.innerText,
      level: parseInt(h.tagName.substring(1)), // 获取 h1, h2, h3 的数字
    });

    // 开始观察
    observer.observe(h);
  });

  tocData.value = toc;
};

/**
 * 点击目录跳转
 * 功能：根据传入的 ID 找到对应 DOM 元素，计算偏移量（减去导航栏高度），执行平滑滚动
 * @param {String} id - 标题元素的 ID
 */
const scrollToHeader = (id) => {
  const el = document.getElementById(id);
  if (el) {
    // 减去顶部导航栏高度 (假设是 80px) + 一点缓冲
    const top = el.getBoundingClientRect().top + window.pageYOffset - 80;
    window.scrollTo({
      top: top,
      behavior: "smooth",
    });
    // 立即手动设置高亮，优化点击体验
    activeHeaderId.value = id;
  }
};

/**
 * 组件卸载时清理
 * 功能：断开 IntersectionObserver 的连接，防止内存泄漏
 */
onUnmounted(() => {
  if (observer) observer.disconnect();
});
</script>

<style scoped>
.article-container {
  width: 100%;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  background-color: #F3F4F6;
}
/* ----------------
   左侧栏样式优化
   ---------------- */
.article-leftContainer {
  width: 220px; /* 稍微调窄 */
  margin-right: 20px;
  background-color: white;
  /* box-shadow: rgba(0, 0, 0, 0.05) 0 4px 12px; 更柔和的阴影 */
  border-radius: 8px;
  position: sticky;
  top: 80px; /* 避开顶部导航 */
  max-height: calc(100vh - 100px);
  padding: 16px 0;
  display: flex;
  flex-direction: column;
  margin-top: 80px;
}

.left-title {
  padding: 0 20px 10px 20px;
  font-weight: bold;
  font-size: 14px;
  color: #999;
  border-bottom: 1px solid #eee;
  margin-bottom: 10px;
}

.article-leftItemContainer {
  width: 100%;
  padding: 10px 20px;
  display: flex;
  align-items: center;
  text-decoration: none;
  color: #475b6d;
  transition: all 0.2s ease;
  border-left: 3px solid transparent;
  font-size: 14px;
}

.article-leftItemContainer:hover {
  color: #5b88e1;
  background-color: #f8faff;
}

.article-leftItemContainer.router-link-active {
  color: #5b88e1;
  background-color: #eef4ff;
  border-left-color: #5b88e1;
  font-weight: 600;
}

/* ----------------
   中间内容区域
   ---------------- */
.article-mainContainerCenterItem {
  width: 760px; /* 调整宽度以容纳三栏 */
  min-height: 800px;
  background-color: white;
  box-shadow: rgba(0, 0, 0, 0.05) 0 4px 12px;
  border-radius: 8px;
  padding: 10px 48px; /* 增加内边距提升阅读感 */
  margin-bottom: 30px;
  margin-top: 80px;
}

/* ----------------
   右侧 TOC 样式 
   ---------------- */
.article-rightContainer {
  width: 200px;
  margin-left: 20px;
  position: sticky;
  top: 80px;
  margin-top: 40px;
}

.toc-wrapper {
  max-height: calc(100vh - 100px);
  overflow-y: auto;
  padding-left: 10px;
  border-left: 1px solid #eee;
}

.toc-title {
  font-size: 14px;
  font-weight: bold;
  color: #999;
  margin-bottom: 12px;
  padding-left: 12px;
}

.toc-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.toc-list li {
  font-size: 13px;
  color: #666;
  padding: 6px 12px;
  cursor: pointer;
  border-radius: 4px;
  transition: all 0.2s;
  line-height: 1.4;
  /* 处理长标题 */
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.toc-list li:hover {
  color: #5b88e1;
}

.toc-list li.active {
  color: #5b88e1;
  background-color: #f0f7ff;
  font-weight: 600;
}

/* 层级缩进 */
.toc-h2 {
  padding-left: 12px !important;
}
.toc-h3 {
  padding-left: 24px !important;
  font-size: 12px !important;
  color: #888;
}

/* ----------------
   UI 小组件
   ---------------- */
.back-to-top {
  position: fixed;
  right: 30px;
  bottom: 30px;
  width: 40px;
  height: 40px;
  border-radius: 50%; /* 圆形按钮更现代 */
  background: #5b88e1;
  color: white;
  border: none;
  box-shadow: 0 4px 12px rgba(91, 136, 225, 0.4);
  cursor: pointer;
  transition: all 0.3s;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
}

.back-to-top:hover {
  transform: translateY(-4px);
  background: #4a75d1;
  box-shadow: 0 6px 16px rgba(91, 136, 225, 0.5);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>