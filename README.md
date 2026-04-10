# QMCP - MCP Server

基于 Node.js 实现的 [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) 服务器，支持 Session 管理、WebSocket 传输和完整的 MCP 协议方法。

## 特性

- **Session 管理** — 自动创建、超时清理、元数据存储
- **WebSocket 传输** — 基于 JSON-RPC 2.0 的双向实时通信
- **HTTP 端点** — 支持无状态 JSON-RPC 调用、健康检查、Session 查询
- **MCP 协议** — 完整实现 Tools / Resources / Prompts 三大能力

## 快速开始

```bash
# 安装依赖
npm install

# 启动服务器 (默认端口 3000)
npm start

# 开发模式 (文件变更自动重启)
npm run dev

# 自定义端口
PORT=8080 npm start
```

## 项目结构

```
├── src/
│   ├── index.js                    # 入口文件，注册工具/资源/提示
│   ├── server/MCPServer.js         # MCP 服务器核心 (HTTP + WebSocket)
│   ├── session/SessionManager.js   # Session 生命周期管理
│   ├── transport/WebSocketTransport.js  # WebSocket 传输层
│   └── handlers/MessageHandler.js  # JSON-RPC 消息处理器
├── FunctionCall/                   # 测试消息集合
│   ├── initialize.json
│   ├── tools_list.json
│   ├── tools_call_echo.json
│   ├── tools_call_calculate.json
│   ├── websocket_full_flow.json
│   └── ...
└── package.json
```

## 接口说明

### HTTP

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/mcp` | JSON-RPC 2.0 端点，可通过 `X-Session-Id` 头复用 Session |
| `GET` | `/health` | 健康检查，返回运行时间、Session 数量等 |
| `GET` | `/sessions` | 查看所有活跃 Session |
| `DELETE` | `/sessions/:id` | 销毁指定 Session |

### WebSocket

连接地址：`ws://localhost:3000/ws`

连接后自动创建 Session，断开时自动销毁。

## 内置工具

| 工具 | 说明 |
|------|------|
| `echo` | 回显输入消息 |
| `get_time` | 获取服务器当前时间 |
| `calculate` | 执行数学表达式计算 |
| `session_info` | 获取当前 Session 详细信息 |

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
npm install -g wscat
wscat -c ws://localhost:3000/ws
# 然后粘贴 FunctionCall/websocket_full_flow.json 中的消息
```

## License

MIT
