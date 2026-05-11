/**
 * 安全机制模块
 * 控制消息发送权限，防止误发
 */

import Conf from 'conf';

export interface SafetyConfig {
  // 白名单：允许发送的会话 ID 列表
  allowedSessions: number[];
  // 是否启用发送确认
  requireConfirmation: boolean;
  // 是否允许发送消息（全局开关）
  allowSending: boolean;
}

const DEFAULT_CONFIG: SafetyConfig = {
  allowedSessions: [],
  requireConfirmation: true,
  allowSending: false,
};

export class SafetyManager {
  private config: Conf<SafetyConfig>;

  constructor() {
    this.config = new Conf<SafetyConfig>({
      projectName: 'qchat-cli',
      defaults: DEFAULT_CONFIG,
    });
  }

  /**
   * 检查是否允许发送消息到指定会话
   */
  isAllowed(sessionId: number): boolean {
    // 全局开关关闭
    if (!this.config.get('allowSending')) {
      return false;
    }

    // 白名单为空时，允许所有
    const allowed = this.config.get('allowedSessions');
    if (allowed.length === 0) {
      return true;
    }

    // 检查白名单
    return allowed.includes(sessionId);
  }

  /**
   * 添加到白名单
   */
  allow(sessionId: number): void {
    const allowed = this.config.get('allowedSessions');
    if (!allowed.includes(sessionId)) {
      allowed.push(sessionId);
      this.config.set('allowedSessions', allowed);
    }
  }

  /**
   * 从白名单移除
   */
  deny(sessionId: number): void {
    const allowed = this.config.get('allowedSessions');
    const index = allowed.indexOf(sessionId);
    if (index !== -1) {
      allowed.splice(index, 1);
      this.config.set('allowedSessions', allowed);
    }
  }

  /**
   * 启用发送功能
   */
  enableSending(): void {
    this.config.set('allowSending', true);
  }

  /**
   * 禁用发送功能
   */
  disableSending(): void {
    this.config.set('allowSending', false);
  }

  /**
   * 设置是否需要确认
   */
  setRequireConfirmation(require: boolean): void {
    this.config.set('requireConfirmation', require);
  }

  /**
   * 获取配置
   */
  getConfig(): SafetyConfig {
    return {
      allowSending: this.config.get('allowSending'),
      allowedSessions: this.config.get('allowedSessions'),
      requireConfirmation: this.config.get('requireConfirmation'),
    };
  }

  /**
   * 获取是否需要确认
   */
  isConfirmationRequired(): boolean {
    return this.config.get('requireConfirmation');
  }
}

// 单例
export const safetyManager = new SafetyManager();
