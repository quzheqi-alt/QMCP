/**
 * BaseAdapter - 存储适配器抽象基类
 * 所有存储后端（Memory / SQLite / Redis / MongoDB）都需要实现这些方法
 */
class BaseAdapter {
  /**
   * 初始化存储连接
   */
  async connect() {
    throw new Error('connect() not implemented');
  }

  /**
   * 保存 Session 数据
   * @param {string} id - Session ID
   * @param {object} data - 要持久化的 Session 数据（序列化后的）
   */
  async save(id, data) {
    throw new Error('save() not implemented');
  }

  /**
   * 读取 Session 数据
   * @param {string} id - Session ID
   * @returns {object|null} Session 数据，不存在返回 null
   */
  async load(id) {
    throw new Error('load() not implemented');
  }

  /**
   * 删除 Session
   * @param {string} id - Session ID
   * @returns {boolean} 是否成功删除
   */
  async delete(id) {
    throw new Error('delete() not implemented');
  }

  /**
   * 获取所有 Session
   * @returns {Array<object>} 所有 Session 数据数组
   */
  async list() {
    throw new Error('list() not implemented');
  }

  /**
   * 清除所有 Session
   */
  async clear() {
    throw new Error('clear() not implemented');
  }

  /**
   * 清理过期 Session
   * @param {number} maxAge - 最大存活时间（毫秒）
   * @returns {number} 清理数量
   */
  async cleanup(maxAge) {
    throw new Error('cleanup() not implemented');
  }

  /**
   * 关闭存储连接
   */
  async disconnect() {
    // 默认空实现
  }

  /**
   * 获取存储引擎名称
   */
  get name() {
    return 'base';
  }
}

export default BaseAdapter;
