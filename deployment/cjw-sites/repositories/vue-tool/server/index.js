import 'dotenv/config' // 自动读取项目根目录下的 .env 文件中的环境变量，例如数据库连接密码等
import express from 'express' // 引入 Express：基于 Node.js 的主流 Web 框架，用于编写 HTTP 接口 (RESTful API)
import mongoose from 'mongoose' // 引入 Mongoose：MongoDB 的对象模型工具，让我们可以用操作对象的方式来便捷操作数据库
import cors from 'cors' // 引入 CORS：解决浏览器前端跨域请求后端接口的安全限制问题
import {
  WebSocketServer
} from 'ws' // 引入 ws：WebSocket 服务器模块，用于与前端建立长连接，实现打字、改表格时的实时同步
import http from 'http' // 引入 Node.js 原生 HTTP 模块，用于把 Express 实例和 WebSocket 实例挂载到同一个端口上
import * as Y from 'yjs' // 引入 Yjs 核心库：这是一个处理协同算法 (CRDT) 的库，解决多人同时修改同一个单元格时的冲突问题

// ==========================================
// 核心修复：处理老旧 CJS 模块与现代 ESM 模块的兼容性问题
// ==========================================
// 背景：Node.js 目前有两种模块系统 (CommonJS 和 ES Modules)。
// 因为 y-websocket 和 y-mongodb-provider 官方包对现代 ESM 支持不太好，
// 直接 import 可能会拿不到里面的方法（变成 undefined），所以这里采取了 `|| 默认导出` 的降级兼容写法。

import * as YWebsocketUtils from 'y-websocket/bin/utils'
// setupWSConnection: y-websocket 提供的核心方法，用于把普通的 websocket 连接“升级”接管为 Yjs 的协同连接
const setupWSConnection =
  YWebsocketUtils.setupWSConnection || YWebsocketUtils.default?.setupWSConnection
// setPersistence: y-websocket 提供的方法，用于绑定数据持久化逻辑（内存数据怎么存到数据库）
const setPersistence = YWebsocketUtils.setPersistence || YWebsocketUtils.default?.setPersistence

import * as YMongodbProvider from 'y-mongodb-provider'
// MongodbPersistence: y-mongodb-provider 提供的类，专门用于把 Yjs 产生的二进制协同历史记录存到 MongoDB 中
const MongodbPersistence =
  YMongodbProvider.MongodbPersistence || YMongodbProvider.default?.MongodbPersistence

// 安全检查：如果加载失败直接在控制台报错提示，方便排查环境问题
if (!setupWSConnection) console.error('❌ 严重错误: setupWSConnection 加载失败')
if (!MongodbPersistence) console.error('❌ 严重错误: MongodbPersistence 加载失败')

// ==========================================
// Express 服务器初始化配置
// ==========================================
const app = express()
// 创建一个底层的 HTTP 服务器，把 express 实例 (app) 传进去。
// 为什么要这样做？因为如果不显式创建 http server，直接 app.listen 的话，
// 我们就无法把 WebSocket 服务器和 HTTP 服务器绑定在同一个端口 (例如 3000) 上了。
const server = http.createServer(app)

// 挂载跨域中间件，允许任何前端域名访问我们的接口
app.use(cors())

// 解析请求体中的 JSON 和 URL-encoded 数据
// 注意：因为 Excel 表格数据有时会非常庞大（包含样式、大量单元格等），
// 所以这里特意将 body 的体积限制放宽到了 '50mb'，防止前端保存时报 Payload Too Large 错误
app.use(express.json({
  limit: '50mb'
}))
app.use(express.urlencoded({
  limit: '50mb',
  extended: true
}))

// 自定义 HTTP 请求日志中间件：打印每一个收到的 HTTP 请求
app.use((req, res, next) => {
  // 忽略 /health 健康检查接口的日志，防止云服务器频繁的心跳检测把终端日志刷屏
  if (req.url !== '/healthz') {
    console.log(`[${new Date().toLocaleTimeString()}] HTTP ${req.method} ${req.url}`)
  }
  next() // 把请求放行给下一个匹配的路由
})

// ==========================================
// 数据库连接 (MongoDB)
// ==========================================
let persistenceReady = false
app.get('/healthz', (_req, res) => {
  const ready = mongoose.connection.readyState === 1 && persistenceReady
  res.status(ready ? 200 : 503).json({ status: ready ? 'ok' : 'unavailable' })
})

const MONGO_URI = process.env.MONGO_URI // 从 .env 取出数据库连接字符串 (如 mongodb://localhost:27017/myexcel)

if (!MONGO_URI) {
  console.error('❌ 未配置 MongoDB 连接字符串 (MONGO_URI)')
  process.exit(1) // 如果没配数据库，服务跑起来也没用，直接停掉服务，避免出现灵异问题
}

// 建立数据库连接
// 注意：这里用 const 接住 mongoose.connect 返回的 promise，
// 后面 Yjs Persistence 初始化需要等它完成，才能拿到底层 driver 的 client 和 db
const mongooseConnectPromise = mongoose
  .connect(MONGO_URI)
  .then(() => console.log('✅ MongoDB 连接成功！'))
  .catch((err) => console.error('❌ MongoDB 连接失败:', err))

// ==========================================
// MongoDB 数据模型定义 (Schema)
// 【重要概念区分】：这里存的是表格的【基础元数据】(例如表格名字、创建时间、最后更新时间等)，
// 而表格【内部的每一个单元格数据 (协同内容)】并不是存在这里，而是由下方的 Yjs Provider 专门以二进制形式管理的！
// ==========================================
const tableSchema = new mongoose.Schema({
  id: {
    type: Number,
    required: true,
    unique: true, // 表格 ID 必须唯一，作为访问房间的唯一标识
    index: true, // 加索引提升查询速度
  },
  name: {
    type: String,
    required: true, // 表格对外展示的名称
  },
  content: {
    type: mongoose.Schema.Types.Mixed,
    default: [], // 预留字段，通常 Yjs 会接管实际内容，此字段可用于存储初始静态结构或备用
  },
  updatedAt: {
    type: Number,
    default: () => Date.now(), // 更新时间戳
  },
  isDeleted: {
    type: Boolean,
    default: false, // 软删除标记。如果是 true，列表接口就不返回它。用于实现“回收站”功能或避免误删
  },
})

// 将 Schema 编译成可以通过代码调用的模型 (Model)
const TableModel = mongoose.model('ExcelTable', tableSchema)

// ==========================================
// Yjs 数据持久化配置 (极其关键)
// 作用：WebSocket 断开或服务器重启后，之前大家协同编辑的表格数据不会丢失。
// ==========================================
let mdb
const pendingWrites = new Set()
function persistUpdate(docName, update) {
  const task = Promise.resolve().then(() => mdb.storeUpdate(docName, update)).catch((err) => {
    persistenceReady = false
    console.error('[Yjs] Failed to persist collaboration update:', err.message)
    throw err
  })
  pendingWrites.add(task)
  task.then(() => pendingWrites.delete(task), () => pendingWrites.delete(task))
  return task
}
// ==========================================
// Yjs 持久化初始化
// 注意：不能直接传 MONGO_URI 字符串给 y-mongodb-provider，
// 因为该库内部用 new URL() 解析连接字符串，而 MongoDB Atlas 的连接字符串
// 包含多个副本集主机（用逗号分隔），标准 new URL() 无法正确解析（会报 Invalid URL）。
// 解决方法：等 mongoose 连上后，把底层的原生 MongoClient 和 Db 实例传进去，
// y-mongodb-provider 支持 {client, db} 对象模式，从而绕开 URL 解析。
// ==========================================
mongooseConnectPromise.then(() => {
  try {
    if (MongodbPersistence) {
      // 从 mongoose 获取底层 MongoDB 驱动对象
      const nativeClient = mongoose.connection.getClient() // 原生 MongoClient
      const nativeDb = nativeClient.db()                    // 原生 Db（使用默认数据库名）
      mdb = new MongodbPersistence(
        { client: nativeClient, db: nativeDb },
        {
          collectionName: 'yjs-transactions',
          flushSize: 100,
          multipleCollections: true,
        }
      )
      console.log('✅ Yjs MongoDB Persistence 初始化成功')
    }
  } catch (err) {
    console.error('❌ Yjs Persistence 初始化失败:', err)
  }

  // 绑定持久化事件：告诉 y-websocket 库，"你要怎样从数据库读取数据，又要怎样把数据写进数据库"
  if (mdb && setPersistence) {
    setPersistence({
      // bindState: 当有第一个用户进入某个表格房间时触发 (从数据库捞历史数据加载到服务器内存)
      bindState: async (docName, ydoc) => {
        // Persist each edit while clients remain connected, including during deployments.
        ydoc.on('update', (update) => { persistUpdate(docName, update).catch(() => {}) })
        try {
          // docName 通常就是前端 WebSocket 连过来时带的 表格ID (roomId)
          const persistedYdoc = await mdb.getYDoc(docName) // 从数据库拉取完整的协同历史二进制文档
          const newUpdates = Y.encodeStateAsUpdate(ydoc) // 获取当前内存里的初始状态
          await persistUpdate(docName, newUpdates) // 更新一下存储层，确保两边一致
          Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(
            persistedYdoc)) // 把历史数据合并应用到当前的内存 ydoc 上，实现数据恢复
        } catch (err) {
          console.error(`[Yjs] bindState 错误 (Room: ${docName}):`, err)
        }
      },
      // writeState: 当内存里的 ydoc 发生改变时(比如某人打了一个字)触发 (从内存写回到数据库备份)
      writeState: async (docName, ydoc) => {
        try {
          const newUpdates = Y.encodeStateAsUpdate(ydoc) // 将全量的修改转化为二进制增量包
          await persistUpdate(docName, newUpdates) // 写入 MongoDB 进行持久化
        } catch (err) {
          console.error(`[Yjs] writeState 错误 (Room: ${docName}):`, err)
        }
      },
    })
    persistenceReady = true
  }
})

// ==========================================
// WebSocket 协同核心逻辑
// ==========================================
// 创建 ws 服务器，并挂载到刚才创建的 HTTP server 上。
// 此时，前端发往这台服务器的 ws:// 请求会被这里拦截，而 http:// 请求则由上方的 express 处理。
const wss = new WebSocketServer({
  server
})

// 监听客户端的 WebSocket 连接请求
wss.on('connection', (conn, req) => {
  // 提取房间 ID。前端连接地址类似: ws://localhost:3000/17154234123
  // req.url.slice(1) 就是把前面的 "/" 去掉，拿到房间 ID "17154234123"
  const roomId = req.url.slice(1)
  console.log(`🔌 新 WebSocket 连接: ${roomId}`)

  // 如果没有房间 ID 视为非法或意外连接，直接踢掉
  if (!roomId) {
    conn.close()
    return
  }

  try {
    if (setupWSConnection) {
      // 魔法开始：把原始的 WebSocket 连接交给 y-websocket 的魔法函数处理
      // 这个函数内部会自动管理同一个房间内的多个客户端、广播每个人的修改给其他人、以及自动心跳保活等复杂的协同逻辑
      setupWSConnection(conn, req, {
        docName: roomId // 指定所属的房间/文档名
      })
    } else {
      console.error('setupWSConnection 未定义，无法处理连接')
      conn.close()
    }
  } catch (err) {
    console.error(`❌ WebSocket 建立失败 (Room: ${roomId}):`, err)
    conn.close()
  }
})

// ==========================================
// 常规 RESTful API 接口 (供前端增删改查表格元数据)
// ==========================================

/**
 * 1. 获取所有的表格列表
 * 前端工作区左侧栏需要展示的列表数据
 */
app.get('/api/table/list', async (req, res) => {
  try {
    // 查找所有未被删除 (isDeleted: false) 的记录
    // 只返回 id, name, updatedAt 字段以节省带宽
    const list = await TableModel.find({
        isDeleted: false
      }, {
        id: 1,
        name: 1,
        updatedAt: 1,
        _id: 0
      })
      .sort({
        updatedAt: -1 // 按照更新时间倒序排列，越新越靠前
      })
    res.json({
      code: 200,
      data: list,
      msg: '获取列表成功'
    })
  } catch (error) {
    console.error(error)
    res.status(500).json({
      code: 500,
      msg: '服务器错误'
    })
  }
})

/**
 * 2. 获取单个表格的详情数据
 * 通常在前端通过 ID 查找某个表格的名称和更新时间时使用
 */
app.get('/api/table/detail/:id', async (req, res) => {
  try {
    const id = Number(req.params.id) // 路由参数中提取 ID
    const table = await TableModel.findOne({
      id: id,
      isDeleted: false
    }, {
      _id: 0
    })

    // 如果找不到对应数据，返回 404
    if (!table) return res.status(404).json({
      code: 404,
      msg: '表格不存在'
    })

    res.json({
      code: 200,
      data: table.content,
      updatedAt: table.updatedAt,
      msg: '成功'
    })
  } catch (error) {
    res.status(500).json({
      code: 500,
      msg: error.message
    })
  }
})

/**
 * 3. 保存/创建新表格 (或者用来重命名表格)
 * 前端点击"新建"或者"重命名"时调用此接口
 */
app.post('/api/table/save', async (req, res) => {
  try {
    const {
      id,
      name
    } = req.body // 从请求体获取 ID 和名称
    const updateData = {
      name,
      updatedAt: Date.now(), // 更新最后修改时间
      isDeleted: false,
    }

    // findOneAndUpdate 的魔法配置：upsert: true
    // 意思是：如果库里有这个 id，就更新它的名字(重命名功能)；如果没有这个 id，就以这个 id 新增一条记录(新建功能)。
    // 这样用一个接口就搞定了新建和更新两种逻辑。
    const result = await TableModel.findOneAndUpdate({
      id: id
    }, {
      $set: updateData
    }, {
      upsert: true, // 不存在则插入
      new: true, // 返回更新后的最新数据
      setDefaultsOnInsert: true // 插入时应用 Schema 的默认值
    })

    res.json({
      code: 200,
      data: {
        id: result.id
      },
      msg: '保存成功'
    })
  } catch (error) {
    res.status(500).json({
      code: 500,
      msg: error.message
    })
  }
})

/**
 * 4. 彻底删除表格
 * 危险操作：从元数据库和 Yjs 持久化库中双重抹除记录
 */
app.post('/api/table/delete', async (req, res) => {
  try {
    const {
      id
    } = req.body

    // 第一步：从常规 MongoDB 中硬删除该表格的元数据 (名称等)
    await TableModel.deleteOne({
      id: id
    })

    // 第二步：如果存在 Yjs 持久化实例，把存放在 yjs-transactions 集合里的二进制协同历史记录也彻底清空
    // 这样别人就算拿到 ID 也无法再恢复表格内容了
    if (mdb) await mdb.clearDocument(String(id))

    res.json({
      code: 200,
      msg: '删除成功'
    })
  } catch (error) {
    res.status(500).json({
      code: 500,
      msg: error.message
    })
  }
})

/**
 * 5. 校验用户本地的 ID 列表是否在服务器上有效
 * 【重要逻辑】：该系统没有做传统的账号登录（匿名协作）。
 * 前端是通过浏览器的 localStorage 记住自己创建/加入过的表格 ID 列表。
 * 当前端刷新页面时，会把本地存的 IDs 一股脑发给这个接口。
 * 服务器查一下哪些 ID 是依然存在的，并把真实存在的表格信息返回给前端。
 * 避免前端列表里显示一个已经被别人彻底删除的废弃表格。
 */
app.post('/api/table/validate', async (req, res) => {
  try {
    const list = req.body // 格式类似: [{id: 123}, {id: 456}]
    if (!Array.isArray(list)) return res.status(400).json({
      code: 400,
      msg: '参数格式错误'
    })

    // 提取出纯数字 ID 数组: [123, 456]
    const ids = list.map((item) => item.id)

    // 批量查询存在的且没被删除的 ID 对应的元数据
    const validTables = await TableModel.find({
      id: {
        $in: ids
      }, // MongoDB 的 "in" 操作符
      isDeleted: false
    }, {
      id: 1,
      name: 1,
      updatedAt: 1,
      _id: 0
    })

    res.json({
      code: 200,
      data: validTables,
      msg: '校验成功'
    })
  } catch (error) {
    res.status(500).json({
      code: 500,
      msg: error.message
    })
  }
})

// ==========================================
// 启动服务器
// ==========================================
const PORT = process.env.PORT || 3000

// 必须启动 server(即 http.createServer 包装后的层) 而不是 app(纯 Express 层)，
// 只有这样，后端的 Express(处理 HTTP) 和 WebSocket(处理 ws) 才能和谐地共享 3000 这一个端口。
server.listen(PORT, process.env.HOST || '0.0.0.0', () => {
  console.log(`🚀 服务运行在 http://localhost:${PORT}`)
  console.log(`🔌 WebSocket 协同服务已就绪`)
})

// Stop accepting connections, close collaboration rooms, then flush pending writes.
let shuttingDown = false
async function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  persistenceReady = false
  const timeout = setTimeout(() => process.exit(1), 25000)
  server.close()
  for (const client of wss.clients) client.close(1012, 'Service restart')
  try {
    await new Promise((resolve) => wss.close(resolve))
    while (pendingWrites.size) await Promise.all([...pendingWrites])
    await mongoose.disconnect()
    clearTimeout(timeout)
    process.exit(0)
  } catch {
    console.error('Failed to flush collaboration data during shutdown')
    process.exit(1)
  }
}
process.once('SIGTERM', shutdown)
process.once('SIGINT', shutdown)
