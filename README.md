# QMCP - MCP Server

基于 Node.js 实现的 [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) 服务器，支持 Session 管理、WebSocket 传输、持久化存储和完整的 MCP 协议方法。

## 特性

- **Session 管理** — 自动创建、超时清理、元数据存储、跨请求数据复用
- **WebSocket 传输** — 基于 JSON-RPC 2.0 的双向实时通信
- **HTTP 端点** — 支持无状态 JSON-RPC 调用、健康检查、Session 查询
- **持久化存储** — 默认 SQLite 本地数据库，支持配置 Redis / MongoDB
- **MCP 协议** — 完整实现 Tools / Resources / Prompts 三大能力

## 快速开始

```bash
# 安装依赖
pnpm install

# 启动服务器（默认端口 3000，SQLite 存储）
pnpm start

# 开发模式（文件变更自动重启）
pnpm dev

# 自定义端口
PORT=8080 pnpm start
```

## 项目结构

```
├── src/
│   ├── index.js                        # 入口文件，注册工具/资源/提示
│   ├── server/MCPServer.js             # MCP 服务器核心 (HTTP + WebSocket)
│   ├── session/SessionManager.js       # Session 生命周期管理
│   ├── transport/WebSocketTransport.js # WebSocket 传输层
│   ├── handlers/MessageHandler.js      # JSON-RPC 消息处理器
│   └── storage/                        # 可插拔存储层
│       ├── BaseAdapter.js              # 存储适配器抽象基类
│       ├── MemoryAdapter.js            # 内存存储（进程重启丢失）
│       ├── SqliteAdapter.js            # SQLite 本地持久化（默认）
│       ├── RedisAdapter.js             # Redis 适配器
│       ├── MongoAdapter.js             # MongoDB 适配器
│       └── StorageFactory.js           # 存储工厂（根据配置创建适配器）
├── FunctionCall/                       # 测试消息集合
├── data/                               # SQLite 数据库文件（自动生成，已 gitignore）
└── package.json
```

## 存储配置

Session 数据之前仅存在内存中，进程重启即丢失。现在支持 4 种存储后端，通过环境变量 `STORAGE_TYPE` 切换：

### SQLite（默认）

本地文件数据库，零配置即可使用，数据保存在 `data/sessions.db`。

```bash
# 默认即 SQLite，无需额外配置
pnpm start

# 自定义数据库文件路径
SQLITE_PATH=./my-data/app.db pnpm start
```

### 内存模式

与改造前行为一致，不持久化，进程重启后数据丢失。

```bash
STORAGE_TYPE=memory pnpm start
```

### Redis

适用于分布式部署、多实例共享 Session 的场景。

```bash
# 1. 安装 Redis 驱动
pnpm add ioredis

# 2. 启动
STORAGE_TYPE=redis REDIS_URL=redis://localhost:6379 pnpm start
```

| 环境变量 | 默认值 | 说明 |
|----------|--------|------|
| `REDIS_URL` | `redis://localhost:6379` | Redis 连接地址 |
| `REDIS_PREFIX` | `mcp:session:` | Key 前缀 |

### MongoDB

适用于需要复杂查询、大规模 Session 管理的场景。

```bash
# 1. 安装 MongoDB 驱动
pnpm add mongodb

# 2. 启动
STORAGE_TYPE=mongodb MONGO_URL=mongodb://localhost:27017 pnpm start
```

| 环境变量 | 默认值 | 说明 |
|----------|--------|------|
| `MONGO_URL` | `mongodb://localhost:27017` | MongoDB 连接地址 |
| `MONGO_DATABASE` | `mcp` | 数据库名 |
| `MONGO_COLLECTION` | `sessions` | 集合名 |

### 存储对比

| 特性 | Memory | SQLite | Redis | MongoDB |
|------|--------|--------|-------|---------|
| 持久化 | 否 | 是 | 是 | 是 |
| 进程重启保留 | 否 | 是 | 是 | 是 |
| 多实例共享 | 否 | 否 | 是 | 是 |
| 额外依赖 | 无 | better-sqlite3 (内置) | ioredis | mongodb |
| 适用场景 | 开发/测试 | 单机部署 | 分布式部署 | 大规模/复杂查询 |

## 接口说明

### HTTP

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/mcp` | JSON-RPC 2.0 端点，可通过 `X-Session-Id` 头复用 Session |
| `GET` | `/health` | 健康检查，返回运行时间、Session 数量、存储类型 |
| `GET` | `/sessions` | 查看所有活跃 Session（含存储中的） |
| `DELETE` | `/sessions/:id` | 销毁指定 Session |

### WebSocket

连接地址：`ws://localhost:3000/ws`

连接后自动创建 Session，断开时数据自动持久化到存储。

## 协议格式

QMCP 基于 [JSON-RPC 2.0](https://www.jsonrpc.org/specification) 进行通信，所有消息（HTTP body 或 WebSocket 帧）都是标准 JSON-RPC 格式。

### 消息结构

#### 请求（Request）

```jsonc
{
  "jsonrpc": "2.0",       // 固定值，JSON-RPC 版本
  "id": 1,                // 请求 ID，整数或字符串，服务器会在响应中原样返回
  "method": "tools/call", // 要调用的方法名
  "params": { ... }       // 方法参数
}
```

#### 响应（Response）— 成功

```jsonc
{
  "jsonrpc": "2.0",
  "id": 1,                // 与请求中的 id 对应
  "result": { ... }       // 返回结果
}
```

#### 响应（Response）— 错误

```jsonc
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32601,        // 错误码（见下方错误码表）
    "message": "Method not found"
  }
}
```

#### 通知（Notification）— 无需响应

```jsonc
{
  "jsonrpc": "2.0",
  "method": "notifications/initialized",  // 通知方法名
  "params": {}
  // 注意：没有 "id" 字段，服务器不会回复
}
```

### 可用方法

| 方法 | 类型 | 说明 |
|------|------|------|
| `initialize` | 请求 | 初始化连接，协商协议版本和能力 |
| `notifications/initialized` | 通知 | 客户端确认初始化完成 |
| `ping` | 请求 | 心跳检测，返回空 `{}` |
| `tools/list` | 请求 | 列出所有可用工具 |
| `tools/call` | 请求 | 调用指定工具 |
| `resources/list` | 请求 | 列出所有可用资源 |
| `resources/read` | 请求 | 读取指定资源 |
| `prompts/list` | 请求 | 列出所有提示模板 |
| `prompts/get` | 请求 | 获取指定提示模板 |

### 错误码

| 错误码 | 含义 |
|--------|------|
| `-32700` | 解析错误 — JSON 格式无效 |
| `-32601` | 方法不存在 |
| `-32603` | 内部错误（如工具执行异常） |
| `-32000` | Session 不存在 |

### 常用消息示例

**1. 初始化握手**

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","clientInfo":{"name":"my-client","version":"1.0.0"}}}
```

**2. 初始化完成通知**（收到上面的响应后发送）

```json
{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}
```

**3. 列出工具**

```json
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
```

**4. 调用工具 — 通用格式**

```jsonc
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"工具名","arguments":{...}}}
```

**5. 调用 `get_time`**（无参数工具）

```json
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_time","arguments":{}}}
```

**6. 调用 `calculate`**（带参数工具）

```json
{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"calculate","arguments":{"expression":"(10 + 20) * 3"}}}
```

**7. 调用 `echo`**

```json
{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"echo","arguments":{"message":"Hello!"}}}
```

**8. 调用 `store_set` / `store_get`**（Session 数据存取）

```json
{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"store_set","arguments":{"key":"username","value":"野崎"}}}
{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"store_get","arguments":{"key":"username"}}}
```

**9. 调用 `chat`**（带会话记忆）

```json
{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"chat","arguments":{"message":"你好，我是野崎"}}}
```

**10. 读取资源**

```json
{"jsonrpc":"2.0","id":9,"method":"resources/read","params":{"uri":"info://server-status"}}
```

**11. 获取提示模板**

```json
{"jsonrpc":"2.0","id":10,"method":"prompts/get","params":{"name":"greeting","arguments":{"username":"野崎","style":"casual"}}}
```

**12. Ping 心跳**

```json
{"jsonrpc":"2.0","id":11,"method":"ping","params":{}}
```

### wscat 快速测试

```bash
# 连接
wscat -c ws://localhost:3000/ws

# 连接后依次粘贴（每行回车发送）：
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","clientInfo":{"name":"wscat","version":"1.0.0"}}}
{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_time","arguments":{}}}
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"calculate","arguments":{"expression":"(10 + 20) * 3"}}}
{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"echo","arguments":{"message":"Hello MCP!"}}}
```

## 内置工具

| 工具 | 说明 |
|------|------|
| `echo` | 回显输入消息 |
| `get_time` | 获取服务器当前时间 |
| `calculate` | 执行数学表达式计算 |
| `session_info` | 获取当前 Session 详细信息 |
| `store_set` | 向 Session 存储 key-value 数据 |
| `store_get` | 从 Session 读取已存储的数据 |
| `store_list` | 列出 Session 中所有存储数据 |
| `store_delete` | 删除 Session 中指定的存储数据 |
| `chat` | 带会话记忆的聊天，消息历史跨请求保留 |

## 环境变量汇总

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3000` | 服务器端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `STORAGE_TYPE` | `sqlite` | 存储类型: `memory` / `sqlite` / `redis` / `mongodb` |
| `SQLITE_PATH` | `./data/sessions.db` | SQLite 数据库文件路径 |
| `REDIS_URL` | `redis://localhost:6379` | Redis 连接地址 |
| `REDIS_PREFIX` | `mcp:session:` | Redis key 前缀 |
| `MONGO_URL` | `mongodb://localhost:27017` | MongoDB 连接地址 |
| `MONGO_DATABASE` | `mcp` | MongoDB 数据库名 |
| `MONGO_COLLECTION` | `sessions` | MongoDB 集合名 |

## 测试示例

`FunctionCall/` 目录包含完整的 MCP 协议测试消息，每个 JSON 文件都有 `request` 和 `expectedResponse`。

### 使用 curl 测试

```bash
# 初始化
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","clientInfo":{"name":"curl","version":"1.0.0"}}}'

# 列出工具
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'

# 调用 echo
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"echo","arguments":{"message":"Hello!"}}}'
```

### 使用 wscat 测试 WebSocket

```bash
pnpm add -g wscat
wscat -c ws://localhost:3000/ws
# 然后粘贴 FunctionCall/ 中的 JSON 消息
```

## License

MIT
