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

  toJSON() {
    return {
      id: this.id,
      createdAt: new Date(this.createdAt).toISOString(),
      lastActiveAt: new Date(this.lastActiveAt).toISOString(),
      metadata: this.metadata,
    };
  }
}

/**
 * SessionManager - 管理所有客户端 Session
 * 支持创建、获取、销毁、超时清理
 */
class SessionManager {
  constructor(options = {}) {
    /** @type {Map<string, Session>} */
    this.sessions = new Map();
    // 默认 Session 超时 30 分钟
    this.sessionTimeout = options.sessionTimeout ?? 30 * 60 * 1000;
    // 清理间隔 5 分钟
    this.cleanupInterval = options.cleanupInterval ?? 5 * 60 * 1000;

    // 启动定时清理
    this._cleanupTimer = setInterval(() => this.cleanup(), this.cleanupInterval);
    this._cleanupTimer.unref(); // 不阻止进程退出
  }

  /**
   * 创建新 Session
   */
  createSession(transport = null) {
    const id = uuidv4();
    const session = new Session(id, transport);
    this.sessions.set(id, session);
    console.log(`[SessionManager] Session created: ${id}`);
    return session;
  }

  /**
   * 获取 Session
   */
  getSession(id) {
    const session = this.sessions.get(id);
    if (session) {
      session.touch();
    }
    return session ?? null;
  }

  /**
   * 销毁 Session
   */
  destroySession(id) {
    const session = this.sessions.get(id);
    if (session) {
      this.sessions.delete(id);
      console.log(`[SessionManager] Session destroyed: ${id}`);
      return true;
    }
    return false;
  }

  /**
   * 获取所有活跃 Session
   */
  getAllSessions() {
    return Array.from(this.sessions.values()).map((s) => s.toJSON());
  }

  /**
   * 清理超时 Session
   */
  cleanup() {
    const now = Date.now();
    let cleaned = 0;
    for (const [id, session] of this.sessions) {
      if (now - session.lastActiveAt > this.sessionTimeout) {
        this.sessions.delete(id);
        cleaned++;
        console.log(`[SessionManager] Session expired and cleaned: ${id}`);
      }
    }
    if (cleaned > 0) {
      console.log(`[SessionManager] Cleaned ${cleaned} expired session(s)`);
    }
  }

  /**
   * 销毁所有 Session
   */
  destroyAll() {
    const count = this.sessions.size;
    this.sessions.clear();
    clearInterval(this._cleanupTimer);
    console.log(`[SessionManager] All ${count} session(s) destroyed`);
  }

  get size() {
    return this.sessions.size;
  }
}

export { Session, SessionManager };
export default SessionManager;
