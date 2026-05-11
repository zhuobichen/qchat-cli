/**
 * 认证模块
 * 管理 OneBot 连接配置和登录状态
 */
import { OneBotClient } from './onebot-client.js';
export interface AuthConfig {
    host: string;
    port: number;
    token?: string;
}
export declare class AuthManager {
    private config;
    private client;
    constructor();
    /**
     * 获取当前配置
     */
    getConfig(): AuthConfig;
    /**
     * 更新配置
     */
    updateConfig(config: Partial<AuthConfig>): void;
    /**
     * 获取 OneBot 客户端
     */
    getClient(): OneBotClient;
    /**
     * 测试连接
     */
    testConnection(): Promise<boolean>;
    /**
     * 获取登录信息
     */
    getLoginInfo(): Promise<import("./onebot-client.js").LoginInfo>;
    /**
     * 清除配置
     */
    clearConfig(): void;
    /**
     * 检查是否已配置
     */
    isConfigured(): boolean;
}
export declare const authManager: AuthManager;
//# sourceMappingURL=auth.d.ts.map