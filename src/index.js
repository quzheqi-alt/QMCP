import MCPServer from './server/MCPServer.js';

/**
 * 从环境变量构建存储配置
 *
 * 环境变量:
 *   STORAGE_TYPE    - 存储类型: memory | sqlite | redis | mongodb (默认 sqlite)
 *   SQLITE_PATH     - SQLite 文件路径 (默认 ./data/sessions.db)
 *   REDIS_URL       - Redis 连接地址 (默认 redis://localhost:6379)
 *   REDIS_PREFIX    - Redis key 前缀 (默认 mcp:session:)
 *   MONGO_URL       - MongoDB 连接地址 (默认 mongodb://localhost:27017)
 *   MONGO_DATABASE  - MongoDB 数据库名 (默认 mcp)
 *   MONGO_COLLECTION - MongoDB 集合名 (默认 sessions)
 */
function buildStorageConfig() {
  const type = process.env.STORAGE_TYPE ?? 'sqlite';
  const options = {};

  switch (type) {
    case 'sqlite':
      if (process.env.SQLITE_PATH) options.filename = process.env.SQLITE_PATH;
      break;
    case 'redis':
      if (process.env.REDIS_URL) options.url = process.env.REDIS_URL;
      if (process.env.REDIS_PREFIX) options.prefix = process.env.REDIS_PREFIX;
      break;
    case 'mongodb':
      if (process.env.MONGO_URL) options.url = process.env.MONGO_URL;
      if (process.env.MONGO_DATABASE) options.database = process.env.MONGO_DATABASE;
      if (process.env.MONGO_COLLECTION) options.collection = process.env.MONGO_COLLECTION;
      break;
  }

  return { type, options };
}

const server = new MCPServer({
  port: parseInt(process.env.PORT ?? '3000', 10),
  host: process.env.HOST ?? '0.0.0.0',
  sessionTimeout: 30 * 60 * 1000, // 30 分钟
  storage: buildStorageConfig(),
});

// ============ 注册示例 Tools ============

server.registerTool(
  'echo',
  '回显输入的消息内容',
  {
    type: 'object',
    properties: {
      message: { type: 'string', description: '要回显的消息' },
    },
    required: ['message'],
  },
  async (args) => {
    return {
      content: [{ type: 'text', text: `Echo: ${args.message}` }],
    };
  }
);

server.registerTool(
  'get_time',
  '获取当前服务器时间',
  {
    type: 'object',
    properties: {},
    required: [],
  },
  async () => {
    const now = new Date();
    return {
      content: [
        {
          type: 'text',
          text: `当前时间: ${now.toISOString()}`,
        },
      ],
    };
  }
);

server.registerTool(
  'calculate',
  '执行基本的数学计算',
  {
    type: 'object',
    properties: {
      expression: { type: 'string', description: '数学表达式，如 2+3*4' },
    },
    required: ['expression'],
  },
  async (args) => {
    try {
      const expr = args.expression;
      if (!/^[\d\s+\-*/().%]+$/.test(expr)) {
        throw new Error('表达式包含不允许的字符');
      }
      const result = Function(`"use strict"; return (${expr})`)();
      return {
        content: [{ type: 'text', text: `计算结果: ${expr} = ${result}` }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `计算错误: ${err.message}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  'session_info',
  '获取当前会话信息，包含 store 数据和消息历史数量',
  {
    type: 'object',
    properties: {},
    required: [],
  },
  async (_args, session) => {
    return {
      content: [{ type: 'text', text: JSON.stringify(session.toJSON(), null, 2) }],
    };
  }
);

// ============ Session 数据复用 Tools ============

server.registerTool(
  'store_set',
  '向当前 Session 存储一个 key-value 数据，后续请求可通过 store_get 读取',
  {
    type: 'object',
    properties: {
      key: { type: 'string', description: '数据的键名' },
      value: { type: 'string', description: '数据的值（支持 JSON 字符串）' },
    },
    required: ['key', 'value'],
  },
  async (args, session) => {
    let value;
    try {
      value = JSON.parse(args.value);
    } catch {
      value = args.value;
    }
    session.storeSet(args.key, value);
    return {
      content: [
        {
          type: 'text',
          text: `已存储: ${args.key} = ${JSON.stringify(value)}\n当前 store 共 ${session.store.size} 个键`,
        },
      ],
    };
  }
);

server.registerTool(
  'store_get',
  '从当前 Session 读取之前存储的数据',
  {
    type: 'object',
    properties: {
      key: { type: 'string', description: '要读取的键名' },
    },
    required: ['key'],
  },
  async (args, session) => {
    if (!session.storeHas(args.key)) {
      return {
        content: [{ type: 'text', text: `键 "${args.key}" 不存在` }],
        isError: true,
      };
    }
    const value = session.storeGet(args.key);
    return {
      content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    };
  }
);

server.registerTool(
  'store_list',
  '列出当前 Session 中所有已存储的数据',
  {
    type: 'object',
    properties: {},
    required: [],
  },
  async (_args, session) => {
    const entries = session.storeEntries();
    const keys = Object.keys(entries);
    if (keys.length === 0) {
      return {
        content: [{ type: 'text', text: 'Session store 为空，尚未存储任何数据' }],
      };
    }
    return {
      content: [{ type: 'text', text: JSON.stringify(entries, null, 2) }],
    };
  }
);

server.registerTool(
  'store_delete',
  '删除当前 Session 中指定的存储数据',
  {
    type: 'object',
    properties: {
      key: { type: 'string', description: '要删除的键名' },
    },
    required: ['key'],
  },
  async (args, session) => {
    const existed = session.storeDelete(args.key);
    return {
      content: [
        {
          type: 'text',
          text: existed
            ? `已删除: ${args.key}`
            : `键 "${args.key}" 不存在`,
        },
      ],
    };
  }
);

server.registerTool(
  'chat',
  '带会话记忆的聊天 - 消息自动追加到当前 Session 的历史中，可跨请求回顾上下文',
  {
    type: 'object',
    properties: {
      message: { type: 'string', description: '用户发送的消息' },
    },
    required: ['message'],
  },
  async (args, session) => {
    session.pushMessage('user', args.message);

    const history = session.getHistory();
    const contextSummary = history
      .map((m) => `[${m.role}] ${m.content}`)
      .join('\n');

    const reply = `收到你的消息（第 ${history.length} 条）。当前会话历史:\n${contextSummary}`;
    session.pushMessage('assistant', reply);

    return {
      content: [{ type: 'text', text: reply }],
    };
  }
);

// ============ 注册示例 Resources ============

server.registerResource(
  'info://server-status',
  'server-status',
  '获取服务器运行状态信息',
  'application/json',
  async (_uri) => {
    return {
      contents: [
        {
          uri: 'info://server-status',
          mimeType: 'application/json',
          text: JSON.stringify({
            uptime: process.uptime(),
            activeSessions: server.sessionManager.size,
            storage: server.sessionManager.storage?.name ?? 'memory-only',
            memoryUsage: process.memoryUsage(),
            timestamp: new Date().toISOString(),
          }),
        },
      ],
    };
  }
);

// ============ 注册示例 Prompts ============

server.registerPrompt(
  'greeting',
  '生成一段个性化的问候语',
  [
    { name: 'username', description: '用户名称', required: true },
    { name: 'style', description: '问候风格: formal/casual', required: false },
  ],
  async (args) => {
    const username = args.username ?? 'User';
    const style = args.style ?? 'casual';
    const greetings = {
      formal: `请以正式、专业的语气向 ${username} 问好，并询问他今天需要什么帮助。`,
      casual: `请用轻松愉快的语气向 ${username} 问好`,
    };
    return {
      description: `为 ${username} 生成的 ${style} 风格问候语`,
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: greetings[style] ?? greetings.casual,
          },
        },
      ],
    };
  }
);

// ============ 启动服务器 ============

async function main() {
  await server.start();

  const shutdown = async () => {
    console.log('\nReceived shutdown signal...');
    await server.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
