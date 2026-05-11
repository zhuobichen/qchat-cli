/**
 * 配置管理模块
 */
import Conf from 'conf';
const DEFAULT_CONFIG = {
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
    config;
    constructor() {
        this.config = new Conf({
            projectName: 'qchat-cli',
            defaults: DEFAULT_CONFIG,
        });
    }
    /**
     * 获取完整配置
     */
    getAll() {
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
    updateConnection(config) {
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
    updateExport(config) {
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
    updateBackup(config) {
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
    getPath() {
        return this.config.path;
    }
}
// 单例
export const configManager = new ConfigManager();
//# sourceMappingURL=index.js.map