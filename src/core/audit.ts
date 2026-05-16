/**
 * 审计日志模块
 * 记录所有敏感操作，用于安全审计
 */

import { writeFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';

export interface AuditLogEntry {
  timestamp: string;
  action: string;
  target: string | number;
  operator: string;
  success: boolean;
  details?: Record<string, any>;
}

export interface AuditConfig {
  enabled: boolean;
  logFile: string;
  console: boolean;
  maxFileSize: number; // KB
}

const DEFAULT_CONFIG: AuditConfig = {
  enabled: true,
  logFile: join(import.meta.dirname, '..', '..', 'audit.log'),
  console: true,
  maxFileSize: 10240, // 10MB
};

export class AuditLogger {
  private config: AuditConfig;
  private logs: AuditLogEntry[] = [];

  constructor(config: Partial<AuditConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 记录日志
   */
  log(entry: Omit<AuditLogEntry, 'timestamp'>): void {
    if (!this.config.enabled) return;

    const fullEntry: AuditLogEntry = {
      timestamp: new Date().toISOString(),
      ...entry,
    };

    this.logs.push(fullEntry);

    // 写入控制台
    if (this.config.console) {
      this.printToConsole(fullEntry);
    }

    // 追加到文件
    try {
      this.appendToFile(fullEntry);
    } catch (error) {
      console.error('写入审计日志失败:', error);
    }
  }

  /**
   * 记录信息级别
   */
  info(action: string, target: string | number, details?: Record<string, any>): void {
    this.log({ action, target, operator: 'system', success: true, details });
  }

  /**
   * 记录警告（危险操作）
   */
  warn(action: string, target: string | number, details?: Record<string, any>): void {
    this.log({ action, target, operator: 'system', success: true, details, details: { ...details, _warning: true } });
  }

  /**
   * 记录成功操作
   */
  success(action: string, target: string | number, details?: Record<string, any>): void {
    this.log({ action, target, operator: 'user', success: true, details });
  }

  /**
   * 记录失败操作
   */
  fail(action: string, target: string | number, details?: Record<string, any>): void {
    this.log({ action, target, operator: 'user', success: false, details });
  }

  /**
   * 打印到控制台
   */
  private printToConsole(entry: AuditLogEntry): void {
    const time = new Date(entry.timestamp).toLocaleString('zh-CN');
    const isWarning = entry.details?._warning;
    const status = entry.success ? chalk.green('✓') : chalk.red('✗');

    if (isWarning) {
      console.log(chalk.yellow(`[${time}] ${status} ${entry.action} → ${entry.target}`));
    } else if (entry.success) {
      console.log(chalk.cyan(`[${time}] ${status} ${entry.action} → ${entry.target}`));
    } else {
      console.log(chalk.red(`[${time}] ${status} ${entry.action} → ${entry.target}`));
    }
  }

  /**
   * 追加到文件
   */
  private appendToFile(entry: AuditLogEntry): void {
    const dir = join(import.meta.dirname, '..', '..');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const logLine = JSON.stringify(entry) + '\n';

    // 检查文件大小
    if (existsSync(this.config.logFile)) {
      const stats = readFileSync(this.config.logFile, 'utf-8');
      if (stats.length > this.config.maxFileSize * 1024) {
        // 文件太大，截断前半部分
        this.rotateLog();
      }
    }

    writeFileSync(this.config.logFile, logLine, { flag: 'a' });
  }

  /**
   * 轮转日志
   */
  private rotateLog(): void {
    const backupFile = this.config.logFile + '.old';
    const content = readFileSync(this.config.logFile, 'utf-8');
    const lines = content.split('\n');
    const half = Math.floor(lines.length / 2);
    
    // 保留后半部分
    writeFileSync(backupFile, lines.slice(half).join('\n') + '\n');
    writeFileSync(this.config.logFile, lines.slice(half).join('\n') + '\n');
  }

  /**
   * 获取最近的日志
   */
  getRecent(count: number = 100): AuditLogEntry[] {
    return this.logs.slice(-count);
  }

  /**
   * 读取文件中的日志
   */
  readFromFile(count: number = 100): AuditLogEntry[] {
    if (!existsSync(this.config.logFile)) return [];

    const content = readFileSync(this.config.logFile, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    const entries = lines.map(line => JSON.parse(line) as AuditLogEntry);
    
    return entries.slice(-count);
  }

  /**
   * 清空日志
   */
  clear(): void {
    this.logs = [];
    if (existsSync(this.config.logFile)) {
      writeFileSync(this.config.logFile, '');
    }
  }
}

// 单例
export const auditLogger = new AuditLogger();
