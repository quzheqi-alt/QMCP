import MemoryAdapter from './MemoryAdapter.js';
import SqliteAdapter from './SqliteAdapter.js';

/**
 * StorageFactory - 根据配置创建对应的存储适配器
 *
 * 配置格式:
 * {
 *   type: 'memory' | 'sqlite' | 'redis' | 'mongodb',
 *   options: { ... }  // 各适配器的特定配置
 * }
 */
class StorageFactory {
  /**
   * 创建存储适配器
   * @param {object} config
   * @param {string} config.type - 存储类型
   * @param {object} [config.options] - 适配器配置
   * @returns {Promise<import('./BaseAdapter.js').default>}
   */
  static async create(config = {}) {
    const type = config.type ?? 'sqlite';
    const options = config.options ?? {};

    let adapter;

    switch (type) {
      case 'memory':
        adapter = new MemoryAdapter();
        break;

      case 'sqlite':
        adapter = new SqliteAdapter(options);
        break;

      case 'redis': {
        const { default: RedisAdapter } = await import('./RedisAdapter.js');
        adapter = new RedisAdapter(options);
        break;
      }

      case 'mongodb': {
        const { default: MongoAdapter } = await import('./MongoAdapter.js');
        adapter = new MongoAdapter(options);
        break;
      }

      default:
        throw new Error(`Unknown storage type: ${type}. Supported: memory, sqlite, redis, mongodb`);
    }

    await adapter.connect();
    return adapter;
  }
}

export default StorageFactory;
