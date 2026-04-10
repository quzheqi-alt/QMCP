import BaseAdapter from './BaseAdapter.js';

/**
 * RedisAdapter - Redis 存储适配器
 * 需要安装依赖: pnpm add ioredis
 *
 * 配置示例:
 * {
 *   type: 'redis',
 *   options: {
 *     url: 'redis://localhost:6379',
 *     prefix: 'mcp:session:'
 *   }
 * }
 */
class RedisAdapter extends BaseAdapter {
  /**
   * @param {object} options
   * @param {string} [options.url] - Redis 连接地址，默认 redis://localhost:6379
   * @param {string} [options.prefix] - key 前缀，默认 'mcp:session:'
   * @param {object} [options.redis] - 其他 ioredis 配置项
   */
  constructor(options = {}) {
    super();
    this.url = options.url ?? 'redis://localhost:6379';
    this.prefix = options.prefix ?? 'mcp:session:';
    this.redisOptions = options.redis ?? {};
    this.client = null;
  }

  async connect() {
    let Redis;
    try {
      Redis = (await import('ioredis')).default;
    } catch {
      throw new Error(
        '[RedisAdapter] 请先安装 ioredis 依赖: pnpm add ioredis'
      );
    }

    this.client = new Redis(this.url, this.redisOptions);

    // 等待连接就绪
    await new Promise((resolve, reject) => {
      this.client.on('ready', () => {
        console.log(`[RedisAdapter] Connected to ${this.url}`);
        resolve();
      });
      this.client.on('error', (err) => reject(err));
    });
  }

  _key(id) {
    return `${this.prefix}${id}`;
  }

  async save(id, data) {
    const json = JSON.stringify(data);
    await this.client.set(this._key(id), json);
  }

  async load(id) {
    const json = await this.client.get(this._key(id));
    if (!json) return null;
    try {
      return JSON.parse(json);
    } catch {
      return null;
    }
  }

  async delete(id) {
    const result = await this.client.del(this._key(id));
    return result > 0;
  }

  async list() {
    const keys = await this.client.keys(`${this.prefix}*`);
    if (keys.length === 0) return [];
    const pipeline = this.client.pipeline();
    keys.forEach((k) => pipeline.get(k));
    const results = await pipeline.exec();
    return results
      .map(([err, json]) => {
        if (err || !json) return null;
        try {
          return JSON.parse(json);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  async clear() {
    const keys = await this.client.keys(`${this.prefix}*`);
    if (keys.length > 0) {
      await this.client.del(...keys);
    }
  }

  async cleanup(maxAge) {
    const sessions = await this.list();
    const now = Date.now();
    let cleaned = 0;
    for (const s of sessions) {
      if (now - (s.lastActiveAt ?? 0) > maxAge) {
        await this.client.del(this._key(s.id));
        cleaned++;
      }
    }
    return cleaned;
  }

  async disconnect() {
    if (this.client) {
      await this.client.quit();
      this.client = null;
      console.log('[RedisAdapter] Disconnected');
    }
  }

  get name() {
    return 'redis';
  }
}

export default RedisAdapter;
