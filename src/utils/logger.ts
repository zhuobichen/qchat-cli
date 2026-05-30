/**
 * 日志格式化工具
 * 提供结构化日志输出
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  NONE = 4,
}

export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  context?: Record<string, any>;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

export class Logger {
  private level: LogLevel;
  private readonly name: string;

  constructor(name: string, level: LogLevel = LogLevel.INFO) {
    this.name = name;
    this.level = level;
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  debug(message: string, context?: Record<string, any>): void {
    if (this.level <= LogLevel.DEBUG) {
      this.log('DEBUG', message, context);
    }
  }

  info(message: string, context?: Record<string, any>): void {
    if (this.level <= LogLevel.INFO) {
      this.log('INFO', message, context);
    }
  }

  warn(message: string, context?: Record<string, any>): void {
    if (this.level <= LogLevel.WARN) {
      this.log('WARN', message, context);
    }
  }

  error(message: string, error?: Error, context?: Record<string, any>): void {
    if (this.level <= LogLevel.ERROR) {
      const errorInfo = error ? {
        name: error.name,
        message: error.message,
        stack: error.stack,
      } : undefined;
      this.log('ERROR', message, context, errorInfo);
    }
  }

  private log(
    level: string,
    message: string,
    context?: Record<string, any>,
    error?: { name: string; message: string; stack?: string }
  ): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context,
      error,
    };

    const formatted = this.format(entry);
    console.log(formatted);

    if (level === 'ERROR' && error) {
      console.error(error.stack);
    }
  }

  private format(entry: LogEntry): string {
    const { timestamp, level, message, context, error } = entry;
    const time = new Date(timestamp).toLocaleString('zh-CN');

    let output = `[${time}] [${level.padEnd(5)}] [${this.name}] ${message}`;

    if (context && Object.keys(context).length > 0) {
      output += ` ${JSON.stringify(context)}`;
    }

    if (error) {
      output += ` ${error.name}: ${error.message}`;
    }

    return output;
  }

  success(message: string, context?: Record<string, any>): void {
    if (this.level <= LogLevel.INFO) {
      this.log('SUCCESS', message, context);
    }
  }

  static createLogger(name: string, level?: LogLevel): Logger {
    return new Logger(name, level);
  }
}

export const rootLogger = new Logger('qchat-cli');

export function createModuleLogger(moduleName: string): Logger {
  return new Logger(moduleName);
}
