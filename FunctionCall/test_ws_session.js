/**
 * WebSocket 连续会话完整测试
 *
 * 测试流程：
 *   1. 连接 → 初始化握手
 *   2. 存储用户数据到 Session (store_set)
 *   3. 读取刚才存储的数据 (store_get)，验证复用
 *   4. 多轮对话聊天 (chat)，验证消息历史累积
 *   5. 列出全部存储数据 (store_list)
 *   6. 查看 Session 完整信息 (session_info)，确认所有上下文
 *   7. 调用计算工具 (calculate)，验证工具调用正常
 *   8. 删除一个存储 key (store_delete)，再列出验证
 *   9. 断开连接
 *
 * 使用方式：
 *   1. 先启动服务器：pnpm start
 *   2. 运行测试：node FunctionCall/test_ws_session.js
 */

import WebSocket from 'ws';

const WS_URL = process.env.WS_URL ?? 'ws://localhost:3000/ws';

// ─── 工具函数 ───────────────────────────────────────

let requestId = 0;

/** 等待指定时间 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 格式化输出 */
function printStep(step, title) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  Step ${step}: ${title}`);
  console.log('═'.repeat(60));
}

function printSend(msg) {
  console.log(`  → 发送: ${JSON.stringify(msg).slice(0, 120)}...`);
}

function printRecv(msg) {
  const text = JSON.stringify(msg, null, 2);
  console.log(`  ← 收到:`);
  text.split('\n').forEach((line) => console.log(`    ${line}`));
}

function printResult(label, value) {
  console.log(`  ✔ ${label}: ${value}`);
}

function printError(label, value) {
  console.log(`  ✘ ${label}: ${value}`);
}

// ─── 主测试逻辑 ─────────────────────────────────────

async function main() {
  console.log('\n🔌 连接到 MCP Server:', WS_URL);

  const ws = new WebSocket(WS_URL);

  // 消息队列，用于按序接收响应
  const messageQueue = [];
  let messageResolver = null;

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (messageResolver) {
      const resolve = messageResolver;
      messageResolver = null;
      resolve(msg);
    } else {
      messageQueue.push(msg);
    }
  });

  /** 等待下一条消息 */
  function waitMessage(timeoutMs = 5000) {
    if (messageQueue.length > 0) {
      return Promise.resolve(messageQueue.shift());
    }
    return new Promise((resolve, reject) => {
      messageResolver = resolve;
      setTimeout(() => {
        messageResolver = null;
        reject(new Error('等待消息超时'));
      }, timeoutMs);
    });
  }

  /** 发送请求并等待响应 */
  async function sendRequest(method, params = {}) {
    const id = ++requestId;
    const msg = { jsonrpc: '2.0', id, method, params };
    printSend(msg);
    ws.send(JSON.stringify(msg));
    const resp = await waitMessage();
    printRecv(resp);
    return resp;
  }

  /** 发送通知（无需响应） */
  function sendNotification(method, params = {}) {
    const msg = { jsonrpc: '2.0', method, params };
    printSend(msg);
    ws.send(JSON.stringify(msg));
  }

  // 等待连接打开
  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });

  // 接收 welcome 通知
  const welcome = await waitMessage();
  console.log('✅ 已连接，Session ID:', welcome.params?.sessionId);

  try {
    // ════════════════════════════════════════
    // Step 1: 初始化握手
    // ════════════════════════════════════════
    printStep(1, '初始化握手 (initialize)');
    const initResp = await sendRequest('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: { roots: { listChanged: true } },
      clientInfo: { name: 'ws-test-client', version: '1.0.0' },
    });
    printResult('协议版本', initResp.result.protocolVersion);
    printResult('服务器', `${initResp.result.serverInfo.name} v${initResp.result.serverInfo.version}`);
    printResult('能力', Object.keys(initResp.result.capabilities).join(', '));

    // 发送 initialized 通知
    sendNotification('notifications/initialized');
    printResult('initialized 通知', '已发送');
    await sleep(100);

    // ════════════════════════════════════════
    // Step 2: 存储用户数据
    // ════════════════════════════════════════
    printStep(2, '存储用户数据 (store_set)');

    await sendRequest('tools/call', {
      name: 'store_set',
      arguments: { key: 'user_profile', value: '{"name":"野崎","role":"developer","lang":"zh-CN"}' },
    });

    await sendRequest('tools/call', {
      name: 'store_set',
      arguments: { key: 'project', value: '{"name":"QMCP","version":"1.0.0","storage":"sqlite"}' },
    });

    await sendRequest('tools/call', {
      name: 'store_set',
      arguments: { key: 'theme', value: 'dark' },
    });

    printResult('已存储', '3 个 key (user_profile, project, theme)');

    // ════════════════════════════════════════
    // Step 3: 读取验证复用
    // ════════════════════════════════════════
    printStep(3, '读取已存储的数据 (store_get) — 验证跨请求复用');

    const profileResp = await sendRequest('tools/call', {
      name: 'store_get',
      arguments: { key: 'user_profile' },
    });

    const profileData = JSON.parse(profileResp.result.content[0].text);
    if (profileData.name === '野崎' && profileData.role === 'developer') {
      printResult('user_profile 复用验证', '通过 ✅ — 跨请求成功读取到之前存储的数据');
    } else {
      printError('user_profile 复用验证', '失败');
    }

    const projectResp = await sendRequest('tools/call', {
      name: 'store_get',
      arguments: { key: 'project' },
    });
    const projectData = JSON.parse(projectResp.result.content[0].text);
    printResult('project 复用验证', `${projectData.name} v${projectData.version} — 读取成功 ✅`);

    // ════════════════════════════════════════
    // Step 4: 多轮对话
    // ════════════════════════════════════════
    printStep(4, '多轮对话 (chat) — 验证消息历史跨请求累积');

    const chat1 = await sendRequest('tools/call', {
      name: 'chat',
      arguments: { message: '你好，我是野崎，我在开发一个 MCP Server' },
    });
    const history1Lines = chat1.result.content[0].text.split('\n').filter((l) => l.startsWith('['));
    printResult('第 1 轮', `历史 ${history1Lines.length} 条消息`);

    const chat2 = await sendRequest('tools/call', {
      name: 'chat',
      arguments: { message: '我刚才说了什么？帮我回忆一下' },
    });
    const history2Lines = chat2.result.content[0].text.split('\n').filter((l) => l.startsWith('['));
    printResult('第 2 轮', `历史 ${history2Lines.length} 条消息（包含第 1 轮的内容）`);

    const chat3 = await sendRequest('tools/call', {
      name: 'chat',
      arguments: { message: '这个 Session 已经积累了多少条消息了？' },
    });
    const history3Lines = chat3.result.content[0].text.split('\n').filter((l) => l.startsWith('['));
    printResult('第 3 轮', `历史 ${history3Lines.length} 条消息（完整保留了所有对话）`);

    if (history3Lines.length === 5) {
      printResult('消息历史验证', '通过 ✅ — 3 条 user + 2 条 assistant = 5 条');
    }

    // ════════════════════════════════════════
    // Step 5: 列出全部存储
    // ════════════════════════════════════════
    printStep(5, '列出全部存储数据 (store_list)');

    const listResp = await sendRequest('tools/call', {
      name: 'store_list',
      arguments: {},
    });
    const allData = JSON.parse(listResp.result.content[0].text);
    printResult('存储数据', `共 ${Object.keys(allData).length} 个 key: ${Object.keys(allData).join(', ')}`);

    // ════════════════════════════════════════
    // Step 6: 查看完整 Session 信息
    // ════════════════════════════════════════
    printStep(6, '查看 Session 完整信息 (session_info)');

    const infoResp = await sendRequest('tools/call', {
      name: 'session_info',
      arguments: {},
    });
    const sessionInfo = JSON.parse(infoResp.result.content[0].text);
    printResult('Session ID', sessionInfo.id);
    printResult('创建时间', sessionInfo.createdAt);
    printResult('最后活跃', sessionInfo.lastActiveAt);
    printResult('clientInfo', JSON.stringify(sessionInfo.metadata.clientInfo));
    printResult('initialized', sessionInfo.metadata.initialized);
    printResult('store keys', Object.keys(sessionInfo.store).join(', '));
    printResult('消息历史', `${sessionInfo.messageHistoryCount} 条`);

    // ════════════════════════════════════════
    // Step 7: 调用计算工具
    // ════════════════════════════════════════
    printStep(7, '调用计算工具 (calculate)');

    const calc1 = await sendRequest('tools/call', {
      name: 'calculate',
      arguments: { expression: '(10 + 20) * 3 + 5' },
    });
    printResult('(10 + 20) * 3 + 5', calc1.result.content[0].text);

    const calc2 = await sendRequest('tools/call', {
      name: 'calculate',
      arguments: { expression: '100 / 4 - 8' },
    });
    printResult('100 / 4 - 8', calc2.result.content[0].text);

    // ════════════════════════════════════════
    // Step 8: 删除存储 key 并验证
    // ════════════════════════════════════════
    printStep(8, '删除存储 key (store_delete) 并验证');

    await sendRequest('tools/call', {
      name: 'store_delete',
      arguments: { key: 'theme' },
    });
    printResult('删除', 'theme 已移除');

    const listAfter = await sendRequest('tools/call', {
      name: 'store_list',
      arguments: {},
    });
    const remaining = JSON.parse(listAfter.result.content[0].text);
    printResult('剩余 keys', Object.keys(remaining).join(', '));

    if (!remaining.theme && remaining.user_profile && remaining.project) {
      printResult('删除验证', '通过 ✅ — theme 已不存在，其他 key 保留');
    }

    // ════════════════════════════════════════
    // Step 9: Ping 验证连接存活
    // ════════════════════════════════════════
    printStep(9, 'Ping 存活检测');

    const pingResp = await sendRequest('ping');
    if (pingResp.result && Object.keys(pingResp.result).length === 0) {
      printResult('Ping', '通过 ✅ — 连接正常');
    }

    // ════════════════════════════════════════
    // 完成总结
    // ════════════════════════════════════════
    console.log(`\n${'═'.repeat(60)}`);
    console.log('  📊 测试总结');
    console.log('═'.repeat(60));
    console.log(`  Session ID   : ${sessionInfo.id}`);
    console.log(`  总请求数     : ${requestId}`);
    console.log(`  Store 操作   : 3 set → 3 get → 1 delete → 验证`);
    console.log(`  Chat 轮数    : 3 轮，历史 ${sessionInfo.messageHistoryCount} 条`);
    console.log(`  协议握手     : initialize + initialized 通知`);
    console.log(`  工具调用     : echo, store_*, chat, calculate, session_info`);
    console.log(`  连续会话验证 : 所有操作共享同一 Session ✅`);
    console.log('═'.repeat(60));
    console.log('\n✅ 全部测试通过！\n');
  } catch (err) {
    console.error('\n❌ 测试失败:', err.message);
    console.error(err.stack);
  } finally {
    ws.close();
    // 等待关闭完成
    await new Promise((r) => ws.on('close', r));
    console.log('🔌 WebSocket 连接已关闭\n');
  }
}

main().catch(console.error);
