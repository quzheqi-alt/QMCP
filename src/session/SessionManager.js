import { v4 as uuidv4 } from 'uuid';

/**
 * Session 会话对象
 */
class Session {
  constructor(id, transport) {
    this.id = id;
    this.transport = transport;
    this.createdAt = Date.now();
    this.lastActiveAt = Date.now();
    this.metadata = {};
    /** @type {Map<string, any>} Session 级数据存储，用于同一会话内跨请求复用数据 */
    this.store = new Map();
    /** @type {Array<{role: string, content: string, timestamp: number}>} 会话消息历史 */
    this.messageHistory = [];
  }

  touch() {
    this.lastActiveAt = Date.now();
  }

  setMeta(key, value) {
    this.metadata[key] = value;
  }

  getMeta(key) {
    return this.metadata[key];
  }

  // ---- Session Store: 数据存取 ----

  storeSet(key, value) {
    this.store.set(key, value);
  }

  storeGet(key) {
    return this.store.get(key);
  }

  storeHas(key) {
    return this.store.has(key);
  }

  storeDelete(key) {
    return this.store.delete(key);
  }

  storeEntries() {
    return Object.fromEntries(this.store);
  }

  // ---- 消息历史 ----

  pushMessage(role, content) {
    this.messageHistory.push({ role, content, timestamp: Date.now() });
  }

  getHistory(limit = 50) {
    return this.messageHistory.slice(-limit);
  }

  /**
   * 序列化为可持久化的纯对象（不含 transport 等不可序列化字段）
   */
  serialize() {
    return {
      id: this.id,
      createdAt: this.createdAt,
      lastActiveAt: this.lastActiveAt,
      metadata: this.metadata,
      store: Object.fromEntries(this.store),
      messageHistory: this.messageHistory,
    };
  }

  /**
   * 从持久化数据还原 Session
   */
  static deserialize(data, transport = null) {
    const session = new Session(data.id, transport);
    session.createdAt = data.createdAt ?? Date.now();
    session.lastActiveAt = data.lastActiveAt ?? Date.now();
    session.metadata = data.metadata ?? {};
    session.store = new Map(Object.entries(data.store ?? {}));
    session.messageHistory = data.messageHistory ?? [];
    return session;
  }

  toJSON() {
    return {
      id: this.id,
      createdAt: new Date(this.createdAt).toISOString(),
      lastActiveAt: new Date(this.lastActiveAt).toISOString(),
      metadata: this.metadata,
      store: Object.fromEntries(this.store),
      messageHistoryCount: this.messageHistory.length,
    };
  }
}

/**
 * SessionManager - 管理所有客户端 Session
 * 支持可插拔的存储后端（Memory / SQLite / Redis / MongoDB）
 */
class SessionManager {
  /**
   * @param {object} options
   * @param {number} [options.sessionTimeout] - Session 超时毫秒数，默认 30 分钟
   * @param {number} [options.cleanupInterval] - 清理间隔毫秒数，默认 5 分钟
   * @param {number} [options.persistInterval] - 持久化间隔毫秒数，默认 30 秒
   * @param {import('../storage/BaseAdapter.js').default} [options.storageAdapter] - 存储适配器
   */
  constructor(options = {}) {
    /** @type {Map<string, Session>} 内存中的活跃 Session（含 transport 等运行时数据） */
    this.sessions = new Map();
    this.sessionTimeout = options.sessionTimeout ?? 30 * 60 * 1000;
    this.cleanupInterval = options.cleanupInterval ?? 5 * 60 * 1000;
    this.persistInterval = options.persistInterval ?? 30 * 1000;

    /** @type {import('../storage/BaseAdapter.js').default|null} */
    this.storage = options.storageAdapter ?? null;

    // 启动定时清理
    this._cleanupTimer = setInterval(() => this.cleanup(), this.cleanupInterval);
    this._cleanupTimer.unref();

    // 如果有存储后端，启动定时持久化
    this._persistTimer = null;
    if (this.storage) {
      this._persistTimer = setInterval(() => this.persistAll(), this.persistInterval);
      this._persistTimer.unref();
    }
  }

  /**
   * 创建新 Session
   */
  async createSession(transport = null) {
    const id = uuidv4();
    const session = new Session(id, transport);
    this.sessions.set(id, session);

    // 持久化到存储
    if (this.storage) {
      await this.storage.save(id, session.serialize());
    }

    console.log(`[SessionManager] Session created: ${id} (storage: ${this.storage?.name ?? 'memory-only'})`);
    return session;
  }

  /**
   * 获取 Session（先查内存，再查存储）
   */
  async getSession(id) {
    // 先从内存查找
    let session = this.sessions.get(id);
    if (session) {
      session.touch();
      return session;
    }

    // 内存中没有，尝试从存储恢复
    if (this.storage) {
      const data = await this.storage.load(id);
      if (data) {
        session = Session.deserialize(data);
        session.touch();
        this.sessions.set(id, session);
        console.log(`[SessionManager] Session restored from ${this.storage.name}: ${id}`);
        return session;
      }
    }

    return null;
  }

  /**
   * 销毁 Session
   */
  async destroySession(id) {
    const existed = this.sessions.delete(id);

    if (this.storage) {
      await this.storage.delete(id);
    }

    if (existed) {
      console.log(`[SessionManager] Session destroyed: ${id}`);
    }
    return existed;
  }

  /**
   * 获取所有活跃 Session
   */
  async getAllSessions() {
    // 如果有存储后端，合并存储中的数据
    if (this.storage) {
      const stored = await this.storage.list();
      // 用内存数据覆盖（内存中的更新）
      const merged = new Map();
      for (const data of stored) {
        merged.set(data.id, data);
      }
      for (const [id, session] of this.sessions) {
        merged.set(id, session.toJSON());
      }
      return Array.from(merged.values());
    }

    return Array.from(this.sessions.values()).map((s) => s.toJSON());
  }

  /**
   * 将所有内存中的 Session 持久化到存储
   */
  async persistAll() {
    if (!this.storage) return;
    let count = 0;
    for (const [id, session] of this.sessions) {
      await this.storage.save(id, session.serialize());
      count++;
    }
    if (count > 0) {
      console.log(`[SessionManager] Persisted ${count} session(s) to ${this.storage.name}`);
    }
  }

  /**
   * 清理超时 Session
   */
  async cleanup() {
    const now = Date.now();
    let cleaned = 0;

    // 清理内存中的
    for (const [id, session] of this.sessions) {
      if (now - session.lastActiveAt > this.sessionTimeout) {
        this.sessions.delete(id);
        cleaned++;
        console.log(`[SessionManager] Session expired: ${id}`);
      }
    }

    // 清理存储中的
    if (this.storage) {
      const storageCleaned = await this.storage.cleanup(this.sessionTimeout);
      cleaned += storageCleaned;
    }

    if (cleaned > 0) {
      console.log(`[SessionManager] Cleaned ${cleaned} expired session(s)`);
    }
  }

  /**
   * 销毁所有 Session 并关闭存储
   */
  async destroyAll() {
    // 持久化最新数据再关闭
    if (this.storage) {
      await this.persistAll();
      await this.storage.disconnect();
    }

    const count = this.sessions.size;
    this.sessions.clear();
    clearInterval(this._cleanupTimer);
    if (this._persistTimer) {
      clearInterval(this._persistTimer);
    }
    console.log(`[SessionManager] All ${count} session(s) destroyed, storage closed`);
  }

  get size() {
    return this.sessions.size;
  }
}

export { Session, SessionManager };
export default SessionManager;
