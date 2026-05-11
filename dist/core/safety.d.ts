/**
 * 安全机制模块
 * 控制消息发送权限，防止误发
 */
export interface SafetyConfig {
    allowedSessions: number[];
    requireConfirmation: boolean;
    allowSending: boolean;
}
export declare class SafetyManager {
    private config;
    constructor();
    /**
     * 检查是否允许发送消息到指定会话
     */
    isAllowed(sessionId: number): boolean;
    /**
     * 添加到白名单
     */
    allow(sessionId: number): void;
    /**
     * 从白名单移除
     */
    deny(sessionId: number): void;
    /**
     * 启用发送功能
     */
    enableSending(): void;
    /**
     * 禁用发送功能
     */
    disableSending(): void;
    /**
     * 设置是否需要确认
     */
    setRequireConfirmation(require: boolean): void;
    /**
     * 获取配置
     */
    getConfig(): SafetyConfig;
    /**
     * 获取是否需要确认
     */
    isConfirmationRequired(): boolean;
}
export declare const safetyManager: SafetyManager;
//# sourceMappingURL=safety.d.ts.map