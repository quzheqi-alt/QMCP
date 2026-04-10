/**
 * MessageHandler - MCP 协议消息处理器
 * 处理 JSON-RPC 2.0 请求，实现 MCP 协议方法
 */
class MessageHandler {
  constructor(server) {
    this.server = server;
    // 注册的工具 (tools)
    this.tools = new Map();
    // 注册的资源 (resources)
    this.resources = new Map();
    // 注册的提示 (prompts)
    this.prompts = new Map();
  }

  /**
   * 注册工具
   */
  registerTool(name, description, inputSchema, handler) {
    this.tools.set(name, { name, description, inputSchema, handler });
    console.log(`[MessageHandler] Tool registered: ${name}`);
  }

  /**
   * 注册资源
   */
  registerResource(uri, name, description, mimeType, handler) {
    this.resources.set(uri, { uri, name, description, mimeType, handler });
    console.log(`[MessageHandler] Resource registered: ${uri}`);
  }

  /**
   * 注册提示模板
   */
  registerPrompt(name, description, args, handler) {
    this.prompts.set(name, { name, description, arguments: args, handler });
    console.log(`[MessageHandler] Prompt registered: ${name}`);
  }

  /**
   * 处理收到的 JSON-RPC 消息
   */
  async handleMessage(message, session) {
    // Notification (无 id)
    if (message.id === undefined || message.id === null) {
      return this._handleNotification(message, session);
    }

    const { id, method, params } = message;

    try {
      let result;

      switch (method) {
        case 'initialize':
          result = this._handleInitialize(params, session);
          break;

        case 'ping':
          result = {};
          break;

        case 'tools/list':
          result = this._handleToolsList(params);
          break;

        case 'tools/call':
          result = await this._handleToolsCall(params, session);
          break;

        case 'resources/list':
          result = this._handleResourcesList(params);
          break;

        case 'resources/read':
          result = await this._handleResourcesRead(params, session);
          break;

        case 'prompts/list':
          result = this._handlePromptsList(params);
          break;

        case 'prompts/get':
          result = await this._handlePromptsGet(params, session);
          break;

        default:
          return {
            jsonrpc: '2.0',
            id,
            error: { code: -32601, message: `Method not found: ${method}` },
          };
      }

      return { jsonrpc: '2.0', id, result };
    } catch (err) {
      console.error(`[MessageHandler] Error handling ${method}:`, err);
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32603, message: err.message },
      };
    }
  }

  /**
   * 处理 initialize 请求
   */
  _handleInitialize(params, session) {
    const clientInfo = params?.clientInfo ?? {};
    console.log(`[MessageHandler] Client initializing:`, JSON.stringify(clientInfo));

    session.setMeta('clientInfo', clientInfo);
    session.setMeta('protocolVersion', params?.protocolVersion ?? '2025-03-26');

    return {
      protocolVersion: '2025-03-26',
      capabilities: {
        tools: { listChanged: true },
        resources: { subscribe: false, listChanged: true },
        prompts: { listChanged: true },
      },
      serverInfo: {
        name: 'mcp-server',
        version: '1.0.0',
      },
    };
  }

  /**
   * 处理 Notification
   */
  _handleNotification(message, session) {
    const { method, params } = message;
    switch (method) {
      case 'notifications/initialized':
        console.log(`[MessageHandler] Client initialized for session: ${session.id}`);
        session.setMeta('initialized', true);
        break;
      case 'notifications/cancelled':
        console.log(`[MessageHandler] Request cancelled:`, params?.requestId);
        break;
      default:
        console.log(`[MessageHandler] Unknown notification: ${method}`);
    }
    return null; // Notification 不需要回复
  }

  /**
   * tools/list
   */
  _handleToolsList(_params) {
    const tools = Array.from(this.tools.values()).map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
    return { tools };
  }

  /**
   * tools/call
   */
  async _handleToolsCall(params, session) {
    const { name, arguments: args } = params;
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }
    return await tool.handler(args ?? {}, session);
  }

  /**
   * resources/list
   */
  _handleResourcesList(_params) {
    const resources = Array.from(this.resources.values()).map((r) => ({
      uri: r.uri,
      name: r.name,
      description: r.description,
      mimeType: r.mimeType,
    }));
    return { resources };
  }

  /**
   * resources/read
   */
  async _handleResourcesRead(params, session) {
    const { uri } = params;
    const resource = this.resources.get(uri);
    if (!resource) {
      throw new Error(`Resource not found: ${uri}`);
    }
    return await resource.handler(uri, session);
  }

  /**
   * prompts/list
   */
  _handlePromptsList(_params) {
    const prompts = Array.from(this.prompts.values()).map((p) => ({
      name: p.name,
      description: p.description,
      arguments: p.arguments,
    }));
    return { prompts };
  }

  /**
   * prompts/get
   */
  async _handlePromptsGet(params, session) {
    const { name, arguments: args } = params;
    const prompt = this.prompts.get(name);
    if (!prompt) {
      throw new Error(`Prompt not found: ${name}`);
    }
    return await prompt.handler(args ?? {}, session);
  }
}

export default MessageHandler;
