/**
 * 认证模块
 * 管理 OneBot 连接配置和登录状态
 *
 * 支持多账号：命名账号存在 accounts.json（Conf 独立文件），互不影响旧的单账号字段。
 * - 从未创建过命名账号时，行为与旧版完全一致（读 config.json 顶层 host/port/token）。
 * - 第一次 addAccount 时，若旧字段已被自定义过（非默认值），自动迁移为名为 "main" 的账号。
 * - --account <name> 或 account use <name> 决定命令实际连接的实例。
 */

import Conf from 'conf';
import { OneBotClient, OneBotConfig } from './onebot-client.js';

export interface AuthConfig {
  host: string;
  port: number;
  token?: string;
}

interface AccountsStore {
  defaultAccount?: string;
  accounts: Record<string, AuthConfig>;
}

const DEFAULT_CONFIG: AuthConfig = {
  host: 'localhost',
  port: 3000,
};

/** 隐式主账号名：旧单账号配置迁移后落在这个名字下 */
export const MAIN_ACCOUNT = 'main';

const ACCOUNT_NAME_RE = /^[a-zA-Z0-9_-]{1,32}$/;

function validateAccountName(name: string): void {
  if (!ACCOUNT_NAME_RE.test(name)) {
    throw new Error('账号名只能包含字母、数字、下划线和连字符，长度 1-32');
  }
}

function validatePort(port: number): void {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('端口必须是 1-65535 之间的整数');
  }
}

function validateHost(host: string): string {
  const trimmed = host.trim();
  if (!trimmed || /[\s\\/@?#]/.test(trimmed)) throw new Error('主机地址格式无效');
  return trimmed;
}

function validateToken(token: string | undefined): string | undefined {
  if (token === undefined) return undefined;
  const trimmed = token.trim();
  if (trimmed.length > 512 || /[\r\n]/.test(trimmed)) throw new Error('Token 格式无效');
  return trimmed || undefined;
}

export interface AccountInfo {
  name: string;
  config: AuthConfig;
  isDefault: boolean;
  /** true = 未做过账号迁移，直接来自旧版单账号字段 */
  implicit: boolean;
}

export class AuthManager {
  private config: Conf<AuthConfig>;
  private accountsStore: Conf<AccountsStore>;
  private activeAccount: string | null = null;
  private client: OneBotClient | null = null;
  private clientAccount: string | null = null;

  constructor() {
    this.config = new Conf<AuthConfig>({
      projectName: 'qchat-cli',
      defaults: DEFAULT_CONFIG,
    });
    this.accountsStore = new Conf<AccountsStore>({
      projectName: 'qchat-cli',
      configName: 'accounts',
      defaults: { accounts: {} },
    });
  }

  /** 旧版单账号字段（config.json 顶层 host/port/token） */
  private legacyConfig(): AuthConfig {
    return {
      host: this.config.get('host'),
      port: this.config.get('port'),
      token: this.config.get('token'),
    };
  }

  /**
   * 解析目标账号：显式指定 > 默认账号 > 旧版单账号字段
   */
  private resolve(name?: string | null): { name: string | null; config: AuthConfig } {
    const target = name ?? this.activeAccount ?? this.accountsStore.get('defaultAccount') ?? null;
    if (!target) {
      return { name: null, config: this.legacyConfig() };
    }
    const accounts = this.accountsStore.get('accounts');
    const config = accounts[target];
    if (!config) {
      throw new Error(`账号 "${target}" 不存在，用 qce account list 查看已有账号`);
    }
    return { name: target, config };
  }

  /** 旧版单账号字段是否被自定义过（值得迁移） */
  private legacyIsCustomized(): boolean {
    const cfg = this.legacyConfig();
    return cfg.host !== DEFAULT_CONFIG.host || cfg.port !== DEFAULT_CONFIG.port || !!cfg.token;
  }

  /** 迁移旧配置为命名账号（幂等） */
  private migrateLegacyIfNeeded(): void {
    const accounts = this.accountsStore.get('accounts');
    if (Object.keys(accounts).length > 0) return;
    if (!this.legacyIsCustomized()) return;
    accounts[MAIN_ACCOUNT] = this.legacyConfig();
    this.accountsStore.set('accounts', accounts);
    this.accountsStore.set('defaultAccount', MAIN_ACCOUNT);
  }

  /**
   * 设置本次调用的目标账号（由全局 --account 触发）
   */
  setActiveAccount(name: string): void {
    this.resolve(name); // 不存在会抛错
    if (this.activeAccount !== name) {
      this.activeAccount = name;
      this.client = null;
      this.clientAccount = null;
    }
  }

  getActiveAccountName(): string | null {
    return this.resolve().name;
  }

  /**
   * 获取当前生效的连接配置（目标账号；无命名账号时为旧版单账号字段）
   */
  getConfig(): AuthConfig {
    return this.resolve().config;
  }

  /**
   * 更新当前目标账号的连接配置
   */
  updateConfig(config: Partial<AuthConfig>): void {
    const target = this.resolve();
    const next: AuthConfig = { ...target.config };
    if (config.host !== undefined) next.host = validateHost(config.host);
    if (config.port !== undefined) {
      validatePort(config.port);
      next.port = config.port;
    }
    if (config.token !== undefined) next.token = validateToken(config.token);

    if (target.name) {
      const accounts = this.accountsStore.get('accounts');
      accounts[target.name] = next;
      this.accountsStore.set('accounts', accounts);
    } else {
      if (config.host !== undefined) this.config.set('host', next.host);
      if (config.port !== undefined) this.config.set('port', next.port);
      if (config.token !== undefined) this.config.set('token', next.token);
    }
    this.client = null;
    this.clientAccount = null;
  }

  /**
   * 获取 OneBot 客户端
   */
  getClient(): OneBotClient {
    const target = this.resolve();
    if (!this.client || this.clientAccount !== target.name) {
      this.client = new OneBotClient(target.config);
      this.clientAccount = target.name;
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
   * 清除当前目标账号的配置
   */
  clearConfig(): void {
    const target = this.resolve();
    if (target.name) {
      this.removeAccount(target.name);
    } else {
      this.config.clear();
    }
    this.client = null;
    this.clientAccount = null;
  }

  /**
   * 检查是否已配置
   */
  isConfigured(): boolean {
    const config = this.resolve().config;
    return !!config.host && !!config.port;
  }

  // ─── 多账号管理 ─────────────────────────────────────────

  /**
   * 新增命名账号。首次添加时自动迁移旧配置为 "main"。
   */
  addAccount(name: string, config: AuthConfig): void {
    validateAccountName(name);
    const accounts = this.accountsStore.get('accounts');
    if (accounts[name]) throw new Error(`账号 "${name}" 已存在`);
    const entry: AuthConfig = {
      host: validateHost(config.host),
      port: (() => { validatePort(config.port); return config.port; })(),
      token: validateToken(config.token),
    };
    this.migrateLegacyIfNeeded();
    const store = this.accountsStore.get('accounts');
    store[name] = entry;
    this.accountsStore.set('accounts', store);
    // 没有默认账号时（全新环境），第一个添加的账号成为默认
    if (!this.accountsStore.get('defaultAccount') && Object.keys(store).length === 1) {
      this.accountsStore.set('defaultAccount', name);
    }
  }

  /**
   * 列出所有账号（含旧配置的隐式 main）
   */
  listAccounts(): AccountInfo[] {
    const accounts = this.accountsStore.get('accounts');
    const def = this.accountsStore.get('defaultAccount');
    const list: AccountInfo[] = Object.entries(accounts).map(([name, config]) => ({
      name,
      config,
      isDefault: def === name,
      implicit: false,
    }));
    // 旧配置尚未迁移时，作为隐式 main 展示
    if (Object.keys(accounts).length === 0) {
      list.unshift({
        name: MAIN_ACCOUNT,
        config: this.getConfig(),
        isDefault: true,
        implicit: true,
      });
    }
    return list;
  }

  /**
   * 设置默认账号（不带 --account 时的连接目标）
   */
  useAccount(name: string): void {
    this.resolve(name);
    this.accountsStore.set('defaultAccount', name);
    this.client = null;
    this.clientAccount = null;
  }

  /**
   * 删除命名账号。删除默认账号时自动切换到剩余的第一个。
   */
  removeAccount(name: string): void {
    const accounts = this.accountsStore.get('accounts');
    if (!accounts[name]) throw new Error(`账号 "${name}" 不存在`);
    delete accounts[name];
    this.accountsStore.set('accounts', accounts);
    if (this.accountsStore.get('defaultAccount') === name) {
      const rest = Object.keys(accounts);
      if (rest.length > 0) this.accountsStore.set('defaultAccount', rest[0]);
      else this.accountsStore.delete('defaultAccount');
    }
    if (this.activeAccount === name) {
      this.activeAccount = null;
      this.client = null;
      this.clientAccount = null;
    }
  }
}

// 单例
export const authManager = new AuthManager();
