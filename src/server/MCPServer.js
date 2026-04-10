import { WebSocketServer } from 'ws';
import http from 'http';
import express from 'express';
import SessionManager from '../session/SessionManager.js';
import WebSocketTransport from '../transport/WebSocketTransport.js';
import MessageHandler from '../handlers/MessageHandler.js';

/**
 * MCPServer - MCP 协议服务器
 * 同时支持 WebSocket 和 HTTP SSE 传输
 */
class MCPServer {
  constructor(options = {}) {
    this.port = options.port ?? 3000;
    this.host = options.host ?? '0.0.0.0';

    this.app = express();
    this.app.use(express.json());

    this.httpServer = http.createServer(this.app);
    this.wss = new WebSocketServer({ server: this.httpServer, path: '/ws' });

    this.sessionManager = new SessionManager({
      sessionTimeout: options.sessionTimeout,
      cleanupInterval: options.cleanupInterval,
    });

    this.messageHandler = new MessageHandler(this);

    this._setupRoutes();
    this._setupWebSocket();
  }

  // ============ 工具 / 资源 / 提示注册代理 ============

  registerTool(name, description, inputSchema, handler) {
    this.messageHandler.registerTool(name, description, inputSchema, handler);
  }

  registerResource(uri, name, description, mimeType, handler) {
    this.messageHandler.registerResource(uri, name, description, mimeType, handler);
  }

  registerPrompt(name, description, args, handler) {
    this.messageHandler.registerPrompt(name, description, args, handler);
  }

  // ============ HTTP 路由 ============

  _setupRoutes() {
    // 健康检查
    this.app.get('/health', (_req, res) => {
      res.json({
        status: 'ok',
        uptime: process.uptime(),
        sessions: this.sessionManager.size,
        timestamp: new Date().toISOString(),
      });
    });

    // 查看所有活跃 Session
    this.app.get('/sessions', (_req, res) => {
      res.json({
        total: this.sessionManager.size,
        sessions: this.sessionManager.getAllSessions(),
      });
    });

    // 删除指定 Session
    this.app.delete('/sessions/:id', (req, res) => {
      const ok = this.sessionManager.destroySession(req.params.id);
      if (ok) {
        res.json({ success: true, message: 'Session destroyed' });
      } else {
        res.status(404).json({ success: false, message: 'Session not found' });
      }
    });

    // HTTP JSON-RPC 端点 (无状态，可选 sessionId header)
    this.app.post('/mcp', async (req, res) => {
      const sessionId = req.headers['x-session-id'];
      let session;

      if (sessionId) {
        session = this.sessionManager.getSession(sessionId);
        if (!session) {
          return res.status(404).json({
            jsonrpc: '2.0',
            id: req.body.id ?? null,
            error: { code: -32000, message: 'Session not found' },
          });
        }
      } else {
        // 为 HTTP 请求创建临时 session
        session = this.sessionManager.createSession(null);
      }

      const response = await this.messageHandler.handleMessage(req.body, session);

      if (response) {
        // 在响应头中返回 sessionId
        res.setHeader('X-Session-Id', session.id);
        res.json(response);
      } else {
        // Notification 无需回复
        res.setHeader('X-Session-Id', session.id);
        res.status(204).end();
      }
    });
  }

  // ============ WebSocket ============

  _setupWebSocket() {
    this.wss.on('connection', (ws, req) => {
      const session = this.sessionManager.createSession(null);
      const transport = new WebSocketTransport(ws, session.id);
      session.transport = transport;

      console.log(`[MCPServer] WebSocket client connected, session: ${session.id}`);

      // 发送欢迎消息（非标准，仅辅助调试）
      transport.send({
        jsonrpc: '2.0',
        method: 'notifications/welcome',
        params: {
          sessionId: session.id,
          message: 'Connected to MCP Server via WebSocket',
        },
      });

      // 处理接收的消息
      transport.onMessage = async (message) => {
        session.touch();
        const response = await this.messageHandler.handleMessage(message, session);
        if (response) {
          await transport.send(response);
        }
      };

      // 连接关闭时清理 Session
      transport.onClose = () => {
        this.sessionManager.destroySession(session.id);
      };

      transport.onError = (err) => {
        console.error(`[MCPServer] Transport error for session ${session.id}:`, err.message);
      };
    });
  }

  // ============ 启动 / 停止 ============

  async start() {
    return new Promise((resolve) => {
      this.httpServer.listen(this.port, this.host, () => {
        console.log('');
        console.log('╔══════════════════════════════════════════════╗');
        console.log('║           MCP Server is running!             ║');
        console.log('╠══════════════════════════════════════════════╣');
        console.log(`║  HTTP  : http://${this.host}:${this.port}            `);
        console.log(`║  WS    : ws://${this.host}:${this.port}/ws            `);
        console.log(`║  Health: http://${this.host}:${this.port}/health      `);
        console.log('╚══════════════════════════════════════════════╝');
        console.log('');
        resolve();
      });
    });
  }

  async stop() {
    console.log('[MCPServer] Shutting down...');
    this.sessionManager.destroyAll();

    // 关闭所有 WebSocket 连接
    this.wss.clients.forEach((client) => client.close());

    return new Promise((resolve, reject) => {
      this.httpServer.close((err) => {
        if (err) reject(err);
        else {
          console.log('[MCPServer] Server stopped');
          resolve();
        }
      });
    });
  }
}

export default MCPServer;
