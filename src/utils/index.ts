
import chalk from 'chalk';

export const DEFAULT_TIMEOUT = 30000; // 30 seconds

/**
 * 带超时的 fetch 封装
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeout: number = DEFAULT_TIMEOUT
): Promise&lt;Response&gt; {
  const controller = new AbortController();
  const timeoutId = setTimeout(() =&gt; controller.abort(), timeout);

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
  info: (...args: unknown[]) =&gt; {
    console.log(chalk.blue('[INFO]'), ...args);
  },
  warn: (...args: unknown[]) =&gt; {
    console.log(chalk.yellow('[WARN]'), ...args);
  },
  error: (...args: unknown[]) =&gt; {
    console.error(chalk.red('[ERROR]'), ...args);
  },
  debug: (...args: unknown[]) =&gt; {
    console.log(chalk.gray('[DEBUG]'), ...args);
  },
  success: (...args: unknown[]) =&gt; {
    console.log(chalk.green('[SUCCESS]'), ...args);
  },
};

/**
 * 重试函数
 */
export async function retry&lt;T&gt;(
  fn: () =&gt; Promise&lt;T&gt;,
  maxRetries: number = 3,
  delay: number = 1000
): Promise&lt;T&gt; {
  let lastError: Error | undefined;

  for (let i = 0; i &lt; maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (i &lt; maxRetries - 1) {
        logger.warn(`请求失败，${delay}ms 后重试 (${i + 1}/${maxRetries})`);
        await new Promise(resolve =&gt; setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

