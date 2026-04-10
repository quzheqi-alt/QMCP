# QMCP Session 复用指南

QMCP 支持两种传输方式的 Session 复用，让多次请求共享同一个上下文（如 `clientInfo`、`initialized` 状态、自定义 metadata 等）。

---

## 一、HTTP 模式下的 Session 复用

HTTP 是无状态协议，需要通过 **`X-Session-Id`** 请求头手动关联 Session。

### 流程说明

```
┌────────┐                         ┌────────────┐
│ Client │                         │ MCP Server │
└───┬────┘                         └─────┬──────┘
    │  POST /mcp (不带 X-Session-Id)     │
    │ ──────────────────────────────────> │  ← 自动创建新 Session
    │  响应头返回 X-Session-Id: abc-123   │
    │ <────────────────────────────────── │
    │                                    │
    │  POST /mcp (带 X-Session-Id)       │
    │  X-Session-Id: abc-123             │
    │ ──────────────────────────────────> │  ← 复用已有 Session
    │  响应 (同一上下文)                  │
    │ <────────────────────────────────── │
```

### 步骤 1：首次请求 — 初始化并获取 Session ID

```bash
curl -v -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2025-03-26",
      "clientInfo": { "name": "my-client", "version": "1.0.0" }
    }
  }'
```

**关键：从响应头中提取 `X-Session-Id`**

```
< HTTP/1.1 200 OK
< X-Session-Id: a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

### 步骤 2：发送 initialized 通知（同一 Session）

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "X-Session-Id: a1b2c3d4-e5f6-7890-abcd-ef1234567890" \
  -d '{
    "jsonrpc": "2.0",
    "method": "notifications/initialized",
    "params": {}
  }'
```

### 步骤 3：在同一 Session 下调用工具

```bash
# 调用 echo 工具 — 使用相同的 Session ID
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "X-Session-Id: a1b2c3d4-e5f6-7890-abcd-ef1234567890" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "echo",
      "arguments": { "message": "Hello with session context!" }
    }
  }'
```

### 步骤 4：验证 Session 上下文已保存

```bash
# 调用 session_info 查看上下文
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "X-Session-Id: a1b2c3d4-e5f6-7890-abcd-ef1234567890" \
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": { "name": "session_info", "arguments": {} }
  }'
```

**返回结果会包含完整上下文**：

```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "createdAt": "2026-04-10T09:00:00.000Z",
  "lastActiveAt": "2026-04-10T09:01:30.000Z",
  "metadata": {
    "clientInfo": { "name": "my-client", "version": "1.0.0" },
    "protocolVersion": "2025-03-26",
    "initialized": true
  }
}
```

### 用脚本串联完整流程

```bash
#!/bin/bash
BASE_URL="http://localhost:3000/mcp"

# 1. 初始化并捕获 Session ID
SESSION_ID=$(curl -s -D - -X POST "$BASE_URL" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","clientInfo":{"name":"bash-client","version":"1.0.0"}}}' \
  | grep -i "x-session-id" | awk '{print $2}' | tr -d '\r')

echo "Session ID: $SESSION_ID"

# 2. 发送 initialized 通知
curl -s -X POST "$BASE_URL" \
  -H "Content-Type: application/json" \
  -H "X-Session-Id: $SESSION_ID" \
  -d '{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}'

# 3. 在同一 Session 下调用工具
curl -s -X POST "$BASE_URL" \
  -H "Content-Type: application/json" \
  -H "X-Session-Id: $SESSION_ID" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"echo","arguments":{"message":"I am in the same session!"}}}' | jq .

# 4. 查看 Session 上下文
curl -s -X POST "$BASE_URL" \
  -H "Content-Type: application/json" \
  -H "X-Session-Id: $SESSION_ID" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"session_info","arguments":{}}}' | jq .
```

---

## 二、WebSocket 模式下的 Session 复用

WebSocket 是长连接，**连接本身就是 Session**，无需额外操作即可自动复用上下文。

### 流程说明

```
┌────────┐                         ┌────────────┐
│ Client │                         │ MCP Server │
└───┬────┘                         └─────┬──────┘
    │  ws://localhost:3000/ws             │
    │ ═══════════════════════════════════>│  ← 建立连接, 自动创建 Session
    │  welcome (sessionId: xxx)          │
    │ <══════════════════════════════════ │
    │                                    │
    │  initialize                        │
    │ ──────────────────────────────────> │  ← 同一 Session
    │  result                            │
    │ <────────────────────────────────── │
    │                                    │
    │  tools/call                        │
    │ ──────────────────────────────────> │  ← 同一 Session, 上下文自动保留
    │  result                            │
    │ <────────────────────────────────── │
    │                                    │
    │  connection close                  │
    │ ═══════════════════════════════════>│  ← Session 自动销毁
```

### 使用 wscat 测试

```bash
# 安装 wscat
npm install -g wscat

# 连接
wscat -c ws://localhost:3000/ws
```

连接后依次发送：

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","clientInfo":{"name":"wscat","version":"1.0.0"}}}
```

```json
{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}
```

```json
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"session_info","arguments":{}}}
```

最后一条返回的 `metadata` 中会包含 `clientInfo` 和 `initialized: true`，证明上下文在同一连接内被完整保留。

### 使用 Node.js 客户端

```javascript
import WebSocket from 'ws';

const ws = new WebSocket('ws://localhost:3000/ws');
let requestId = 0;

function send(method, params = {}, hasId = true) {
  const msg = { jsonrpc: '2.0', method, params };
  if (hasId) msg.id = ++requestId;
  ws.send(JSON.stringify(msg));
}

ws.on('open', () => {
  // 1. 初始化
  send('initialize', {
    protocolVersion: '2025-03-26',
    clientInfo: { name: 'node-client', version: '1.0.0' },
  });
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  console.log('收到:', JSON.stringify(msg, null, 2));

  // 2. 收到 initialize 响应后发送 initialized 通知
  if (msg.id === 1 && msg.result) {
    send('notifications/initialized', {}, false);

    // 3. 调用工具 — 此时 Session 已有完整上下文
    send('tools/call', { name: 'echo', arguments: { message: '同一 Session!' } });
    send('tools/call', { name: 'session_info', arguments: {} });
  }

  // 收到 session_info 结果后关闭
  if (msg.id === 3) {
    console.log('\n✅ Session 上下文验证完成');
    ws.close();
  }
});
```

---

## 三、Session 管理 API

| 操作 | 方法 | 路径 | 说明 |
|------|------|------|------|
| 查看所有 Session | `GET` | `/sessions` | 返回当前所有活跃 Session 及元数据 |
| 销毁指定 Session | `DELETE` | `/sessions/:id` | 手动终止某个 Session |
| 健康检查 | `GET` | `/health` | 包含活跃 Session 数量 |

```bash
# 查看所有活跃 Session
curl -s http://localhost:3000/sessions | jq .

# 销毁指定 Session
curl -X DELETE http://localhost:3000/sessions/a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

---

## 四、两种模式对比

| 特性 | HTTP | WebSocket |
|------|------|-----------|
| Session 创建 | 首次请求自动创建 | 连接时自动创建 |
| Session 复用 | 需通过 `X-Session-Id` 头手动传递 | 连接期间自动复用 |
| Session 销毁 | 调用 `DELETE /sessions/:id` 或等待超时 | 断开连接时自动销毁 |
| 超时清理 | 30 分钟无活动自动清理 | 连接断开即清理 |
| 适用场景 | 无状态调用、REST 风格集成 | 长期交互、实时通信 |
