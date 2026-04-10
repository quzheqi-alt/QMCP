/**
 * WebSocket Transport - 基于 WebSocket 的 MCP 传输层
 * 符合 MCP 协议的 JSON-RPC 2.0 消息格式
 */
class WebSocketTransport {
  constructor(ws, sessionId) {
    this.ws = ws;
    this.sessionId = sessionId;
    this._onMessage = null;
    this._onClose = null;
    this._onError = null;
    this._isOpen = true;

    this.ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        console.log(`[WS:${this.sessionId}] ← Received:`, JSON.stringify(message));
        if (this._onMessage) {
          this._onMessage(message);
        }
      } catch (err) {
        console.error(`[WS:${this.sessionId}] Parse error:`, err.message);
        this._sendError(null, -32700, 'Parse error');
      }
    });

    this.ws.on('close', (code, reason) => {
      this._isOpen = false;
      console.log(`[WS:${this.sessionId}] Connection closed (code: ${code})`);
      if (this._onClose) {
        this._onClose();
      }
    });

    this.ws.on('error', (err) => {
      console.error(`[WS:${this.sessionId}] WebSocket error:`, err.message);
      if (this._onError) {
        this._onError(err);
      }
    });
  }

  /**
   * 设置消息处理回调
   */
  set onMessage(handler) {
    this._onMessage = handler;
  }

  set onClose(handler) {
    this._onClose = handler;
  }

  set onError(handler) {
    this._onError = handler;
  }

  /**
   * 发送 JSON-RPC 响应
   */
  async send(message) {
    if (!this._isOpen) {
      throw new Error('WebSocket connection is closed');
    }
    const payload = JSON.stringify(message);
    console.log(`[WS:${this.sessionId}] → Sending:`, payload);
    return new Promise((resolve, reject) => {
      this.ws.send(payload, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * 发送 JSON-RPC 错误
   */
  async _sendError(id, code, message) {
    return this.send({
      jsonrpc: '2.0',
      id: id,
      error: { code, message },
    });
  }

  /**
   * 关闭连接
   */
  async close() {
    this._isOpen = false;
    this.ws.close();
  }

  get isOpen() {
    return this._isOpen && this.ws.readyState === 1; // WebSocket.OPEN
  }
}

export default WebSocketTransport;
