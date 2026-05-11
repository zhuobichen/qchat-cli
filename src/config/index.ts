/**
 * 配置管理模块
 */

import Conf from 'conf';

export interface AppConfig {
  // 连接配置
  connection: {
    host: string;
    port: number;
    token?: string;
  };
  // 导出配置
  export: {
    defaultFormat: string;
    defaultOutput: string;
    limit?: number;
  };
  // 备份配置
  backup: {
    enabled: boolean;
    schedule?: string; // cron 表达式
    output: string;
    sessions: number[]; // 要备份的会话 ID 列表，空表示全部
    format: string;
  };
}

const DEFAULT_CONFIG: AppConfig = {
  connection: {
    host: 'localhost',
    port: 3000,
  },
  export: {
    defaultFormat: 'json',
    defaultOutput: './output',
  },
  backup: {
    enabled: false,
    output: './backup',
    sessions: [],
    format: 'json',
  },
};

export class ConfigManager {
  private config: Conf<AppConfig>;

  constructor() {
    this.config = new Conf<AppConfig>({
      projectName: 'qchat-cli',
      defaults: DEFAULT_CONFIG,
    });
  }

  /**
   * 获取完整配置
   */
  getAll(): AppConfig {
    return this.config.store;
  }

  /**
   * 获取连接配置
   */
  getConnection() {
    return this.config.get('connection');
  }

  /**
   * 更新连接配置
   */
  updateConnection(config: Partial<AppConfig['connection']>) {
    const current = this.config.get('connection');
    this.config.set('connection', { ...current, ...config });
  }

  /**
   * 获取导出配置
   */
  getExport() {
    return this.config.get('export');
  }

  /**
   * 更新导出配置
   */
  updateExport(config: Partial<AppConfig['export']>) {
    const current = this.config.get('export');
    this.config.set('export', { ...current, ...config });
  }

  /**
   * 获取备份配置
   */
  getBackup() {
    return this.config.get('backup');
  }

  /**
   * 更新备份配置
   */
  updateBackup(config: Partial<AppConfig['backup']>) {
    const current = this.config.get('backup');
    this.config.set('backup', { ...current, ...config });
  }

  /**
   * 重置配置
   */
  reset() {
    this.config.clear();
  }

  /**
   * 获取配置文件路径
   */
  getPath(): string {
    return this.config.path;
  }
}

// 单例
export const configManager = new ConfigManager();
