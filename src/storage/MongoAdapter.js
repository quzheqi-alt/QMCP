import BaseAdapter from './BaseAdapter.js';

/**
 * MongoAdapter - MongoDB 存储适配器
 * 需要安装依赖: pnpm add mongodb
 *
 * 配置示例:
 * {
 *   type: 'mongodb',
 *   options: {
 *     url: 'mongodb://localhost:27017',
 *     database: 'mcp',
 *     collection: 'sessions'
 *   }
 * }
 */
class MongoAdapter extends BaseAdapter {
  /**
   * @param {object} options
   * @param {string} [options.url] - MongoDB 连接地址
   * @param {string} [options.database] - 数据库名称，默认 'mcp'
   * @param {string} [options.collection] - 集合名称，默认 'sessions'
   */
  constructor(options = {}) {
    super();
    this.url = options.url ?? 'mongodb://localhost:27017';
    this.dbName = options.database ?? 'mcp';
    this.collectionName = options.collection ?? 'sessions';
    this.client = null;
    this.collection = null;
  }

  async connect() {
    let MongoClient;
    try {
      ({ MongoClient } = await import('mongodb'));
    } catch {
      throw new Error(
        '[MongoAdapter] 请先安装 mongodb 依赖: pnpm add mongodb'
      );
    }

    this.client = new MongoClient(this.url);
    await this.client.connect();

    const db = this.client.db(this.dbName);
    this.collection = db.collection(this.collectionName);

    // 创建索引
    await this.collection.createIndex({ id: 1 }, { unique: true });
    await this.collection.createIndex({ lastActiveAt: 1 });

    const count = await this.collection.countDocuments();
    console.log(`[MongoAdapter] Connected to ${this.url}/${this.dbName} (${count} existing sessions)`);
  }

  async save(id, data) {
    await this.collection.updateOne(
      { id },
      { $set: { id, data, lastActiveAt: data.lastActiveAt ?? Date.now() } },
      { upsert: true }
    );
  }

  async load(id) {
    const doc = await this.collection.findOne({ id });
    return doc?.data ?? null;
  }

  async delete(id) {
    const result = await this.collection.deleteOne({ id });
    return result.deletedCount > 0;
  }

  async list() {
    const docs = await this.collection.find({}).sort({ lastActiveAt: -1 }).toArray();
    return docs.map((d) => d.data).filter(Boolean);
  }

  async clear() {
    await this.collection.deleteMany({});
  }

  async cleanup(maxAge) {
    const cutoff = Date.now() - maxAge;
    const result = await this.collection.deleteMany({ lastActiveAt: { $lt: cutoff } });
    return result.deletedCount;
  }

  async disconnect() {
    if (this.client) {
      await this.client.close();
      this.client = null;
      console.log('[MongoAdapter] Disconnected');
    }
  }

  get name() {
    return 'mongodb';
  }
}

export default MongoAdapter;
