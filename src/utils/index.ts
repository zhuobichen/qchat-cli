
import chalk from 'chalk';

export const DEFAULT_TIMEOUT = 30000; // 30 seconds

/**
 * 带超时的 fetch 封装
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeout: number = DEFAULT_TIMEOUT
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 简单的日志系统
 */
export const logger = {
  info: (...args: unknown[]) => {
    console.log(chalk.blue('[INFO]'), ...args);
  },
  warn: (...args: unknown[]) => {
    console.log(chalk.yellow('[WARN]'), ...args);
  },
  error: (...args: unknown[]) => {
    console.error(chalk.red('[ERROR]'), ...args);
  },
  debug: (...args: unknown[]) => {
    console.log(chalk.gray('[DEBUG]'), ...args);
  },
  success: (...args: unknown[]) => {
    console.log(chalk.green('[SUCCESS]'), ...args);
  },
};

/**
 * 重试函数
 */
export async function retry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  delay: number = 1000
): Promise<T> {
  let lastError: Error | undefined;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (i < maxRetries - 1) {
        logger.warn(`请求失败，${delay}ms 后重试 (${i + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}
