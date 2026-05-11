/**
 * 配置管理模块
 */
export interface AppConfig {
    connection: {
        host: string;
        port: number;
        token?: string;
    };
    export: {
        defaultFormat: string;
        defaultOutput: string;
        limit?: number;
    };
    backup: {
        enabled: boolean;
        schedule?: string;
        output: string;
        sessions: number[];
        format: string;
    };
}
export declare class ConfigManager {
    private config;
    constructor();
    /**
     * 获取完整配置
     */
    getAll(): AppConfig;
    /**
     * 获取连接配置
     */
    getConnection(): {
        host: string;
        port: number;
        token?: string;
    };
    /**
     * 更新连接配置
     */
    updateConnection(config: Partial<AppConfig['connection']>): void;
    /**
     * 获取导出配置
     */
    getExport(): {
        defaultFormat: string;
        defaultOutput: string;
        limit?: number;
    };
    /**
     * 更新导出配置
     */
    updateExport(config: Partial<AppConfig['export']>): void;
    /**
     * 获取备份配置
     */
    getBackup(): {
        enabled: boolean;
        schedule?: string;
        output: string;
        sessions: number[];
        format: string;
    };
    /**
     * 更新备份配置
     */
    updateBackup(config: Partial<AppConfig['backup']>): void;
    /**
     * 重置配置
     */
    reset(): void;
    /**
     * 获取配置文件路径
     */
    getPath(): string;
}
export declare const configManager: ConfigManager;
//# sourceMappingURL=index.d.ts.map