/**
 * 认证模块
 * 管理 OneBot 连接配置和登录状态
 */

import Conf from 'conf';
import { OneBotClient, OneBotConfig } from './onebot-client.js';

export interface AuthConfig {
  host: string;
  port: number;
  token?: string;
}

const DEFAULT_CONFIG: AuthConfig = {
  host: 'localhost',
  port: 3000,
};

export class AuthManager {
  private config: Conf<AuthConfig>;
  private client: OneBotClient | null = null;

  constructor() {
    this.config = new Conf<AuthConfig>({
      projectName: 'qchat-cli',
      defaults: DEFAULT_CONFIG,
    });
  }

  /**
   * 获取当前配置
   */
  getConfig(): AuthConfig {
    return {
      host: this.config.get('host'),
      port: this.config.get('port'),
      token: this.config.get('token'),
    };
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<AuthConfig>): void {
    if (config.host !== undefined) this.config.set('host', config.host);
    if (config.port !== undefined) this.config.set('port', config.port);
    if (config.token !== undefined) this.config.set('token', config.token);
    this.client = null; // 重置客户端
  }

  /**
   * 获取 OneBot 客户端
   */
  getClient(): OneBotClient {
    if (!this.client) {
      const config = this.getConfig();
      this.client = new OneBotClient(config);
    }
    return this.client;
  }

  /**
   * 测试连接
   */
  async testConnection(): Promise<boolean> {
    const client = this.getClient();
    return client.testConnection();
  }

  /**
   * 获取登录信息
   */
  async getLoginInfo() {
    const client = this.getClient();
    return client.getLoginInfo();
  }

  /**
   * 清除配置
   */
  clearConfig(): void {
    this.config.clear();
    this.client = null;
  }

  /**
   * 检查是否已配置
   */
  isConfigured(): boolean {
    const config = this.getConfig();
    return !!config.host && !!config.port;
  }
}

// 单例
export const authManager = new AuthManager();
