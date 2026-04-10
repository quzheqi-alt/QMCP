import { WebSocketServer } from 'ws';
import http from 'http';
import express from 'express';
import SessionManager from '../session/SessionManager.js';
import WebSocketTransport from '../transport/WebSocketTransport.js';
import MessageHandler from '../handlers/MessageHandler.js';
import StorageFactory from '../storage/StorageFactory.js';

/**
 * MCPServer - MCP 协议服务器
 * 同时支持 WebSocket 和 HTTP SSE 传输
 */
class MCPServer {
  /**
   * @param {object} options
   * @param {number} [options.port]
   * @param {string} [options.host]
   * @param {number} [options.sessionTimeout]
   * @param {number} [options.cleanupInterval]
   * @param {object} [options.storage] - 存储配置 { type: 'sqlite'|'memory'|'redis'|'mongodb', options: {...} }
   */
  constructor(options = {}) {
    this.port = options.port ?? 3000;
    this.host = options.host ?? '0.0.0.0';
    this._options = options;

    this.app = express();
    this.app.use(express.json());

    this.httpServer = http.createServer(this.app);
    this.wss = new WebSocketServer({ server: this.httpServer, path: '/ws' });

    // SessionManager 将在 start() 中异步初始化
    this.sessionManager = null;
    this.messageHandler = new MessageHandler(this);
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
        storage: this.sessionManager.storage?.name ?? 'memory-only',
        timestamp: new Date().toISOString(),
      });
    });

    // 查看所有活跃 Session
    this.app.get('/sessions', async (_req, res) => {
      const sessions = await this.sessionManager.getAllSessions();
      res.json({
        total: sessions.length,
        storage: this.sessionManager.storage?.name ?? 'memory-only',
        sessions,
      });
    });

    // 删除指定 Session
    this.app.delete('/sessions/:id', async (req, res) => {
      const ok = await this.sessionManager.destroySession(req.params.id);
      if (ok) {
        res.json({ success: true, message: 'Session destroyed' });
      } else {
        res.status(404).json({ success: false, message: 'Session not found' });
      }
    });

    // HTTP JSON-RPC 端点 (可选 sessionId header)
    this.app.post('/mcp', async (req, res) => {
      const sessionId = req.headers['x-session-id'];
      let session;

      if (sessionId) {
        session = await this.sessionManager.getSession(sessionId);
        if (!session) {
          return res.status(404).json({
            jsonrpc: '2.0',
            id: req.body.id ?? null,
            error: { code: -32000, message: 'Session not found' },
          });
        }
      } else {
        session = await this.sessionManager.createSession(null);
      }

      const response = await this.messageHandler.handleMessage(req.body, session);

      if (response) {
        res.setHeader('X-Session-Id', session.id);
        res.json(response);
      } else {
        res.setHeader('X-Session-Id', session.id);
        res.status(204).end();
      }
    });
  }

  // ============ WebSocket ============

  _setupWebSocket() {
    this.wss.on('connection', async (ws, req) => {
      // 支持通过 ?sessionId=xxx 重连到已有 Session
      const url = new URL(req.url, `http://${req.headers.host}`);
      const reconnectId = url.searchParams.get('sessionId');

      let session = null;
      let isReconnect = false;

      if (reconnectId) {
        session = await this.sessionManager.getSession(reconnectId);
        if (session) {
          isReconnect = true;
          console.log(`[MCPServer] WebSocket client reconnected to session: ${session.id}`);
        } else {
          console.log(`[MCPServer] Session ${reconnectId} not found, creating new session`);
        }
      }

      if (!session) {
        session = await this.sessionManager.createSession(null);
        console.log(`[MCPServer] WebSocket client connected, new session: ${session.id}`);
      }

      // 绑定新的 transport
      const transport = new WebSocketTransport(ws, session.id);
      session.transport = transport;

      // 发送 welcome / reconnected 通知
      transport.send({
        jsonrpc: '2.0',
        method: isReconnect ? 'notifications/reconnected' : 'notifications/welcome',
        params: {
          sessionId: session.id,
          reconnected: isReconnect,
          message: isReconnect
            ? 'Reconnected to existing session'
            : 'Connected to MCP Server via WebSocket',
          ...(isReconnect ? {
            storeKeys: Object.keys(session.storeEntries()),
            messageHistoryCount: session.messageHistory.length,
          } : {}),
        },
      });

      transport.onMessage = async (message) => {
        session.touch();
        const response = await this.messageHandler.handleMessage(message, session);
        if (response) {
          await transport.send(response);
        }
      };

      // 每秒发送心跳
      const heartbeatTimer = setInterval(() => {
        if (transport.isOpen) {
          transport.send({
            jsonrpc: '2.0',
            method: 'notifications/heartbeat',
            params: {
              sessionId: session.id,
              timestamp: Date.now(),
              uptime: process.uptime(),
            },
          }).catch(() => {});
        }
      }, 1000);

      transport.onClose = async () => {
        clearInterval(heartbeatTimer);
        // 断开时只持久化，不删除 Session（支持后续重连）
        if (this.sessionManager.storage) {
          await this.sessionManager.storage.save(session.id, session.serialize());
        }
        session.transport = null;
        console.log(`[MCPServer] WebSocket disconnected: ${session.id} (session preserved for reconnect)`);
      };

      transport.onError = (err) => {
        clearInterval(heartbeatTimer);
        console.error(`[MCPServer] Transport error for session ${session.id}:`, err.message);
      };
    });
  }

  // ============ 启动 / 停止 ============

  async start() {
    // 初始化存储
    const storageConfig = this._options.storage ?? { type: 'sqlite' };
    const storageAdapter = await StorageFactory.create(storageConfig);

    this.sessionManager = new SessionManager({
      sessionTimeout: this._options.sessionTimeout,
      cleanupInterval: this._options.cleanupInterval,
      storageAdapter,
    });

    this._setupRoutes();
    this._setupWebSocket();

    return new Promise((resolve) => {
      this.httpServer.listen(this.port, this.host, () => {
        console.log('');
        console.log('╔══════════════════════════════════════════════════════╗');
        console.log('║              MCP Server is running!                 ║');
        console.log('╠══════════════════════════════════════════════════════╣');
        console.log(`║  HTTP    : http://${this.host}:${this.port}                  `);
        console.log(`║  WS      : ws://${this.host}:${this.port}/ws                  `);
        console.log(`║  Health  : http://${this.host}:${this.port}/health              `);
        console.log(`║  Storage : ${storageAdapter.name}                              `);
        console.log('╚══════════════════════════════════════════════════════╝');
        console.log('');
        resolve();
      });
    });
  }

  async stop() {
    console.log('[MCPServer] Shutting down...');
    await this.sessionManager.destroyAll();

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
