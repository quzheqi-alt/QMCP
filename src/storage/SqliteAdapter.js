import Database from 'better-sqlite3';
import path from 'path';
import BaseAdapter from './BaseAdapter.js';

/**
 * SqliteAdapter - SQLite 本地数据库存储适配器
 * Session 数据持久化到本地 .sqlite 文件，进程重启后数据保留
 */
class SqliteAdapter extends BaseAdapter {
  /**
   * @param {object} options
   * @param {string} [options.filename] - 数据库文件路径，默认 ./data/sessions.db
   */
  constructor(options = {}) {
    super();
    this.filename = options.filename ?? path.join(process.cwd(), 'data', 'sessions.db');
    this.db = null;
  }

  async connect() {
    // 确保目录存在
    const dir = path.dirname(this.filename);
    const { mkdirSync } = await import('fs');
    mkdirSync(dir, { recursive: true });

    this.db = new Database(this.filename);

    // 启用 WAL 模式提升并发性能
    this.db.pragma('journal_mode = WAL');

    // 创建 sessions 表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_active_at INTEGER NOT NULL
      )
    `);

    // 预编译常用语句
    this._stmts = {
      upsert: this.db.prepare(`
        INSERT INTO sessions (id, data, created_at, last_active_at)
        VALUES (@id, @data, @createdAt, @lastActiveAt)
        ON CONFLICT(id) DO UPDATE SET
          data = @data,
          last_active_at = @lastActiveAt
      `),
      load: this.db.prepare('SELECT data FROM sessions WHERE id = ?'),
      delete: this.db.prepare('DELETE FROM sessions WHERE id = ?'),
      list: this.db.prepare('SELECT data FROM sessions ORDER BY last_active_at DESC'),
      clear: this.db.prepare('DELETE FROM sessions'),
      cleanup: this.db.prepare('DELETE FROM sessions WHERE last_active_at < ?'),
      count: this.db.prepare('SELECT COUNT(*) as count FROM sessions'),
    };

    const { count } = this._stmts.count.get();
    console.log(`[SqliteAdapter] Connected to ${this.filename} (${count} existing sessions)`);
  }

  async save(id, data) {
    const json = JSON.stringify(data);
    this._stmts.upsert.run({
      id,
      data: json,
      createdAt: data.createdAt ?? Date.now(),
      lastActiveAt: data.lastActiveAt ?? Date.now(),
    });
  }

  async load(id) {
    const row = this._stmts.load.get(id);
    if (!row) return null;
    try {
      return JSON.parse(row.data);
    } catch {
      return null;
    }
  }

  async delete(id) {
    const result = this._stmts.delete.run(id);
    return result.changes > 0;
  }

  async list() {
    const rows = this._stmts.list.all();
    return rows.map((row) => {
      try {
        return JSON.parse(row.data);
      } catch {
        return null;
      }
    }).filter(Boolean);
  }

  async clear() {
    this._stmts.clear.run();
  }

  async cleanup(maxAge) {
    const cutoff = Date.now() - maxAge;
    const result = this._stmts.cleanup.run(cutoff);
    return result.changes;
  }

  async disconnect() {
    if (this.db) {
      this.db.close();
      this.db = null;
      console.log('[SqliteAdapter] Database connection closed');
    }
  }

  get name() {
    return 'sqlite';
  }
}

export default SqliteAdapter;
