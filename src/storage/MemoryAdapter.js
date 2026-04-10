import BaseAdapter from './BaseAdapter.js';

/**
 * MemoryAdapter - 内存存储适配器
 * Session 数据存储在 JavaScript Map 中，进程重启后丢失
 */
class MemoryAdapter extends BaseAdapter {
  constructor() {
    super();
    /** @type {Map<string, object>} */
    this._store = new Map();
  }

  async connect() {
    console.log('[MemoryAdapter] Using in-memory storage');
  }

  async save(id, data) {
    this._store.set(id, { ...data, _updatedAt: Date.now() });
  }

  async load(id) {
    return this._store.get(id) ?? null;
  }

  async delete(id) {
    return this._store.delete(id);
  }

  async list() {
    return Array.from(this._store.values());
  }

  async clear() {
    this._store.clear();
  }

  async cleanup(maxAge) {
    const now = Date.now();
    let cleaned = 0;
    for (const [id, data] of this._store) {
      if (now - (data.lastActiveAt ?? data._updatedAt ?? 0) > maxAge) {
        this._store.delete(id);
        cleaned++;
      }
    }
    return cleaned;
  }

  async disconnect() {
    this._store.clear();
  }

  get name() {
    return 'memory';
  }
}

export default MemoryAdapter;
