import { WebSocketServer } from 'ws';
import http from 'node:http';
import { createRequire } from 'module';
import path from 'path';
import { pathToFileURL } from 'url';

// y-websocket 1.x 将 server 工具放在 bin/utils.js，但未在 exports 中暴露。
// 通过 resolve package.json 后拼路径 + file:// 动态导入，绕过 exports 限制。
const require = createRequire(import.meta.url);
let setupWSConnection;
try {
  const pkgPath = require.resolve('y-websocket/package.json');
  const utilsPath = path.join(path.dirname(pkgPath), 'bin', 'utils.js');
  ({ setupWSConnection } = await import(pathToFileURL(utilsPath)));
} catch (err) {
  console.error('[mindmap] 无法加载 y-websocket/bin/utils.js，请确认安装 y-websocket@1.5.4');
  throw err;
}

// 简单的 Y.js WebSocket 协同服务，默认端口 1234，可通过环境变量覆盖
const PORT = Number(process.env.MINDMAP_WS_PORT || 1234);

// 记录活跃房间，用于日志观测
const rooms = new Map();

const server = http.createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end('{"status":"ok"}');
  }
  res.writeHead(404);
  res.end();
});
const wss = new WebSocketServer({ server });
server.listen(PORT);

wss.on('connection', (conn, req) => {
  // 路由格式：ws://host:port/<roomName>
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const roomName = url.pathname.slice(1) || 'default';

  // 使用 y-websocket 内置的文档管理与 Awareness，同步节点与连线
  setupWSConnection(conn, req, { docName: roomName });

  const count = (rooms.get(roomName) || 0) + 1;
  rooms.set(roomName, count);
  console.log(`[mindmap] client join room=${roomName} online=${count}`);

  conn.on('close', () => {
    const next = Math.max((rooms.get(roomName) || 1) - 1, 0);
    if (next === 0) {
      rooms.delete(roomName);
    } else {
      rooms.set(roomName, next);
    }
    console.log(`[mindmap] client leave room=${roomName} online=${next}`);
  });
});

wss.on('listening', () => {
  console.log(`[mindmap] y-websocket server listening on ws://localhost:${PORT}`);
});

wss.on('error', (err) => {
  console.error('[mindmap] server error', err);
});

