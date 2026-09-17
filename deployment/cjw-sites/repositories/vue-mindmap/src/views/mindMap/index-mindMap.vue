<template>
  <div
    class="mindMap-container"
    @mousemove="handleConnectMove"
    @mouseup="handleConnectEnd"
  >
    <!-- === 侧边栏工具箱 === -->
    <div class="sidebar-panel">
      <div class="sidebar-header">本地协同导图 🚀</div>

      <!-- 1. 协同连接设置 -->
      <div class="control-section">
        <div class="section-title">连接设置 (Node服务)</div>

        <!-- 连接状态指示器 -->
        <div class="status-bar" :class="{ online: isOnline, error: hasError }">
          <span class="status-dot"></span>
          {{ statusText }}
        </div>

        <div class="control-group" style="margin-top: 10px">
          <label class="input-label">房间号</label>
          <div class="btn-row">
            <input
              v-model="roomName"
              type="text"
              class="sidebar-input"
              @keydown.enter="reconnect"
            />
            <button class="sidebar-btn primary" @click="reconnect">进入</button>
          </div>
          <div class="server-tip">协作服务连接失败，请稍后重试</div>
        </div>
      </div>

      <div class="divider"></div>

      <!-- 2. 在线用户列表 -->
      <div class="control-section flex-grow">
        <div class="section-title">在线用户 ({{ users.length }})</div>
        <div class="saved-list">
          <div
            v-for="user in users"
            :key="user.clientId"
            class="saved-item"
            :class="{ active: user.clientId === myClientId }"
          >
            <span
              class="user-avatar"
              :style="{ background: user.color }"
            ></span>
            <span class="saved-name">
              {{ user.name }}
              {{ user.clientId === myClientId ? "(我)" : "" }}
            </span>
          </div>
        </div>
      </div>

      <div class="divider"></div>

      <!-- 3. 添加节点控制区 -->
      <div class="control-section">
        <div class="section-title">快速操作</div>
        <div class="control-group">
          <input
            v-model="newNodeText"
            type="text"
            placeholder="输入节点内容..."
            class="sidebar-input"
            @keyup.enter="addNode"
          />
          <button
            style="margin-top: 10px"
            class="sidebar-btn success"
            @click="addNode"
          >
            + 添加节点
          </button>
        </div>
      </div>

      <div class="divider"></div>

      <!-- 4. 操作说明 -->
      <div class="instruction-list">
        <div class="instruction-item">
          <span class="key-tag">Shift + 拖拽</span>
          <span>连线</span>
        </div>
        <div class="instruction-item">
          <span class="key-tag">双击节点</span>
          <span>编辑</span>
        </div>
      </div>
    </div>

    <!-- SVG 连线层 -->
    <svg class="svg-container">
      <path
        v-if="isConnecting && tempLine"
        :d="generateTempPath()"
        stroke="#94a3b8"
        stroke-width="2"
        stroke-dasharray="5,5"
        fill="none"
      />
      <path
        v-for="link in links"
        :key="`${link.source.id}-${link.target.id}`"
        class="connection-path"
        :d="generatePath(link)"
        stroke="#cbd5e1"
        stroke-width="2"
        fill="none"
        @contextmenu.prevent="deleteConnection(link.rawIndex)"
      >
        <title>右键点击删除连线</title>
      </path>
    </svg>

    <!-- 节点层 -->
    <mindItem
      v-for="node in nodes"
      :key="node.id"
      :id="node.id"
      :content="node.content"
      :x="node.x"
      :y="node.y"
      :color="node.color"
      @update-position="handleUpdatePosition"
      @update-content="handleUpdateContent"
      @start-connect="handleStartConnect"
    ></mindItem>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from "vue";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import mindItem from "./components/mindItem.vue"; // 确保路径正确

// --- 状态定义 ---
const nodes = ref([]);
const connections = ref([]);
const users = ref([]);
const isOnline = ref(false);
const hasError = ref(false);
const roomName = ref("project-alpha"); // 默认房间名
const myClientId = ref(0);
const newNodeText = ref("");
const statusText = computed(() => {
  if (hasError.value) return "连接失败，请确认 Node 服务已启动";
  if (isOnline.value) return `已连接: ${roomName.value}`;
  return "连接中...";
});

// --- Y.js 核心变量 ---
let ydoc = null;
let provider = null;
let yNodesMap = null; // 使用 Y.Map 存储节点，方便按ID更新
let yConnectionsArray = null; // 使用 Y.Array 存储连线
let awareness = null;

// 用户颜色池
const USER_COLORS = [
  "#ef4444",
  "#f59e0b",
  "#10b981",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
];

// --- 协同初始化 ---
const initYjs = () => {
  // 清理旧连接
  if (provider) {
    provider.destroy();
    ydoc.destroy();
  }

  hasError.value = false;
  isOnline.value = false;

  // 1. 创建文档
  ydoc = new Y.Doc();

  // 2. 连接本地 Node.js WebSocket 服务
  // 端口要和 server.js 里的一致 (1234)
  const wsUrl = import.meta.env.DEV
    ? "ws://localhost:1234"
    : `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/mindmap-ws`;
  provider = new WebsocketProvider(wsUrl, roomName.value, ydoc);

  // 3. 绑定数据结构
  yNodesMap = ydoc.getMap("nodes");
  yConnectionsArray = ydoc.getArray("connections");

  // 4. 监听连接状态
  provider.on("status", (event) => {
    isOnline.value = event.status === "connected";
    if (isOnline.value) hasError.value = false;
  });

  provider.on("connection-error", () => {
    hasError.value = true;
    isOnline.value = false;
  });

  provider.on("connection-close", () => {
    isOnline.value = false;
  });

  // 5. 处理感知信息 (Awareness - 在线用户)
  awareness = provider.awareness;
  myClientId.value = awareness.clientID;

  // 设置我的信息
  const randomColor =
    USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)];
  awareness.setLocalState({
    name: `User ${Math.floor(Math.random() * 1000)}`,
    color: randomColor,
  });

  // 监听其他用户变化
  awareness.on("change", () => {
    const states = awareness.getStates();
    users.value = Array.from(states.entries()).map(([id, state]) => ({
      clientId: id,
      ...state,
    }));
  });

  // 6. 核心：数据同步观察者

  // 监听节点变化：当 Y.Map 变动时，更新 Vue 的 nodes
  yNodesMap.observe(() => {
    nodes.value = Array.from(yNodesMap.values());
  });

  // 监听连线变化：当 Y.Array 变动时，更新 Vue 的 connections
  yConnectionsArray.observe(() => {
    connections.value = yConnectionsArray.toArray();
  });

  // 初始加载
  nodes.value = Array.from(yNodesMap.values());
  connections.value = yConnectionsArray.toArray();
};

const reconnect = () => {
  if (roomName.value.trim()) {
    initYjs();
  }
};

onMounted(() => {
  initYjs();
});

onUnmounted(() => {
  if (provider) provider.destroy();
  if (ydoc) ydoc.destroy();
});

// --- 业务逻辑 (对接 Y.js) ---

/**
 * 添加节点 -> 写入 Y.Map
 */
const addNode = () => {
  const id = Date.now();
  const content = newNodeText.value.trim() || "新想法";
  const startX = 300 + Math.random() * 100;
  const startY = 200 + Math.random() * 100;

  // 从 awareness 获取当前用户颜色，标记这个节点是谁创建的
  const myState = awareness.getLocalState();
  const color = myState ? myState.color : "#666";

  const nodeData = { id, content, x: startX, y: startY, color };

  // Y.js 操作：Map.set(key, value)
  // 这会自动同步给所有连接的客户端
  yNodesMap.set(String(id), nodeData);

  newNodeText.value = "";
};

/**
 * 更新位置 -> 修改 Y.Map 中对应的数据
 */
const handleUpdatePosition = ({ id, x, y }) => {
  const node = yNodesMap.get(String(id));
  if (node) {
    // 覆盖旧对象（也可以只更新部分，但为了简单直接替换对象属性）
    // 注意：在更高频的场景下，可以考虑 Y.Map 的嵌套属性优化，但这里直接替换对象足够了
    yNodesMap.set(String(id), { ...node, x, y });
  }
};

/**
 * 更新内容
 */
const handleUpdateContent = ({ id, content }) => {
  const node = yNodesMap.get(String(id));
  if (node) {
    yNodesMap.set(String(id), { ...node, content });
  }
};

// --- 连线逻辑 (对接 Y.Array) ---

const links = computed(() => {
  // 转换 connections 数据为带有 node 引用的对象，供 SVG 渲染
  return connections.value
    .map((conn, index) => {
      const source = nodes.value.find((n) => n.id === conn.sourceId);
      const target = nodes.value.find((n) => n.id === conn.targetId);
      if (!source || !target) return null;
      return { source, target, rawIndex: index };
    })
    .filter(Boolean);
});

const isConnecting = ref(false);
const connectingSourceId = ref(null);
const mousePos = ref({ x: 0, y: 0 });
const tempLine = computed(() => isConnecting.value && connectingSourceId.value);

const handleStartConnect = ({ id }) => {
  isConnecting.value = true;
  connectingSourceId.value = id;
};

const handleConnectMove = (e) => {
  if (!isConnecting.value) return;
  mousePos.value = { x: e.clientX, y: e.clientY };
};

const handleConnectEnd = (e) => {
  if (!isConnecting.value) return;
  const targetEl = document
    .elementFromPoint(e.clientX, e.clientY)
    ?.closest(".mindItem-box");

  if (targetEl) {
    const targetId = Number(targetEl.dataset.id);
    const sourceId = connectingSourceId.value;

    if (targetId && targetId !== sourceId) {
      // 检查重复
      const exists = connections.value.some(
        (c) => c.sourceId === sourceId && c.targetId === targetId,
      );
      if (!exists) {
        // Y.js 操作：push 到数组
        // 这里的事务是原子的，所有客户端都会同时看到这条线
        yConnectionsArray.push([{ sourceId, targetId }]);
      }
    }
  }
  isConnecting.value = false;
  connectingSourceId.value = null;
};

/**
 * 删除连线 -> 从 Y.Array 移除
 */
const deleteConnection = (index) => {
  yConnectionsArray.delete(index, 1);
};

// --- SVG 路径生成 (复用原逻辑) ---
const NODE_WIDTH = 160;
const NODE_HEIGHT = 54;
const BEZIER_OFFSET = 60;

const generatePath = (link) => {
  const { source, target } = link;
  const sx = source.x + NODE_WIDTH / 2;
  const sy = source.y + NODE_HEIGHT / 2;
  const tx = target.x + NODE_WIDTH / 2;
  const ty = target.y + NODE_HEIGHT / 2;
  const dx = tx - sx;
  const dy = ty - sy;

  let start = {},
    end = {},
    c1 = {},
    c2 = {};

  if (Math.abs(dx) >= Math.abs(dy)) {
    if (dx > 0) {
      start = { x: source.x + NODE_WIDTH, y: sy };
      end = { x: target.x, y: ty };
      c1 = { x: start.x + BEZIER_OFFSET, y: start.y };
      c2 = { x: end.x - BEZIER_OFFSET, y: end.y };
    } else {
      start = { x: source.x, y: sy };
      end = { x: target.x + NODE_WIDTH, y: ty };
      c1 = { x: start.x - BEZIER_OFFSET, y: start.y };
      c2 = { x: end.x + BEZIER_OFFSET, y: end.y };
    }
  } else {
    if (dy > 0) {
      start = { x: sx, y: source.y + NODE_HEIGHT };
      end = { x: tx, y: target.y };
      c1 = { x: start.x, y: start.y + BEZIER_OFFSET };
      c2 = { x: end.x, y: end.y - BEZIER_OFFSET };
    } else {
      start = { x: sx, y: source.y };
      end = { x: tx, y: target.y + NODE_HEIGHT };
      c1 = { x: start.x, y: start.y - BEZIER_OFFSET };
      c2 = { x: end.x, y: end.y + BEZIER_OFFSET };
    }
  }
  return `M ${start.x} ${start.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${end.x} ${end.y}`;
};

const generateTempPath = () => {
  const sourceNode = nodes.value.find((n) => n.id === connectingSourceId.value);
  if (!sourceNode) return "";
  return `M ${sourceNode.x + NODE_WIDTH / 2} ${sourceNode.y + NODE_HEIGHT / 2} L ${mousePos.value.x} ${mousePos.value.y}`;
};
</script>

<style scoped>
/* 基础样式复用 */
.mindMap-container {
  width: 100%;
  height: 100vh;
  position: relative;
  background-color: #f3f4f6;
  background-image: radial-gradient(#d1d5db 1px, transparent 1px);
  background-size: 20px 20px;
  overflow: hidden;
  user-select: none;
}

.svg-container {
  width: 100%;
  height: 100%;
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
  z-index: 1;
}

.connection-path {
  pointer-events: visibleStroke;
  cursor: pointer;
  transition: stroke 0.2s;
}
.connection-path:hover {
  stroke: #ef4444;
  stroke-width: 4px;
}

/* 侧边栏样式调整 */
.sidebar-panel {
  position: absolute;
  top: 80px;
  right: 20px;
  width: 280px;
  background: white;
  border-radius: 12px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
  padding: 16px;
  z-index: 100;
  display: flex;
  flex-direction: column;
  max-height: 90vh;
}

.sidebar-header {
  font-size: 18px;
  font-weight: 700;
  margin-bottom: 12px;
  color: #1f2937;
}

.control-section {
  margin-bottom: 16px;
}
.control-section.flex-grow {
  flex: 1;
  min-height: 100px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.section-title {
  font-size: 12px;
  color: #6b7280;
  margin-bottom: 8px;
  font-weight: 600;
}

.status-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: #4b5563;
  padding: 8px;
  background: #f9fafb;
  border-radius: 6px;
  border: 1px solid #e5e7eb;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: #9ca3af;
  transition: background-color 0.3s;
}
.status-bar.online .status-dot {
  background-color: #10b981;
  box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.2);
}
.status-bar.online {
  color: #059669;
  background: #ecfdf5;
  border-color: #a7f3d0;
}
.status-bar.error .status-dot {
  background-color: #ef4444;
}
.status-bar.error {
  color: #dc2626;
  background: #fef2f2;
  border-color: #fecaca;
}

.sidebar-input {
  width: 100%;
  padding: 8px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  outline: none;
  box-sizing: border-box;
}
.sidebar-input:focus {
  border-color: #3b82f6;
}

.btn-row {
  display: flex;
  gap: 8px;
  margin-top: 6px;
}

.sidebar-btn {
  padding: 8px 12px;
  border-radius: 6px;
  border: none;
  cursor: pointer;
  color: white;
  font-size: 13px;
  white-space: nowrap;
}
.sidebar-btn.primary {
  background: #3b82f6;
}
.sidebar-btn.success {
  background: #10b981;
}
.sidebar-btn:hover {
  opacity: 0.9;
}

.server-tip {
  font-size: 11px;
  color: #9ca3af;
  margin-top: 4px;
  font-family: monospace;
}

.saved-list {
  flex: 1;
  overflow-y: auto;
  border: 1px solid #f3f4f6;
  border-radius: 6px;
  background: #f9fafb;
}

.saved-item {
  display: flex;
  align-items: center;
  padding: 8px 10px;
  border-bottom: 1px solid #f3f4f6;
  gap: 8px;
  font-size: 13px;
  color: #374151;
}
.saved-item.active {
  background: #eff6ff;
}

.user-avatar {
  width: 16px;
  height: 16px;
  border-radius: 4px;
}

.divider {
  height: 1px;
  background: #e5e7eb;
  margin: 12px 0;
}

.instruction-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.instruction-item {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: #6b7280;
}
.key-tag {
  background: #f3f4f6;
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid #e5e7eb;
}
</style>
