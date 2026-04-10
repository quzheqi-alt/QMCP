import MCPServer from './server/MCPServer.js';

const server = new MCPServer({
  port: parseInt(process.env.PORT ?? '3000', 10),
  host: process.env.HOST ?? '0.0.0.0',
  sessionTimeout: 30 * 60 * 1000, // 30 分钟
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
      // 安全校验：只允许数字、运算符、括号和空格
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
  '获取当前会话信息',
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

  // 优雅退出
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
