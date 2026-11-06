/**
 * 可靠性内核：超时 → 重试 → 熔断 → 死信队列（DLQ）。
 *
 * 设计原则：
 *   - 每一步都有界（超时/次数），不让一个坏调用拖死整个流程
 *   - 重试用指数退避 + 抖动，避免多个调用同时重试打爆下游
 *   - 熔断是"按 key"的（不同会话互不影响）
 *   - 失败的任务不丢：进 DLQ 落盘，可人工重放
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface RetryOptions {
  /** 单次调用超时（毫秒） */
  timeoutMs?: number;
  /** 最大尝试次数（含首次） */
  attempts?: number;
  /** 退避基数（毫秒）：第 n 次等待 base * 2^(n-1) */
  backoffMs?: number;
  /** 退避上限 */
  maxBackoffMs?: number;
  /** 随机源，注入以便测试确定性 */
  random?: () => number;
  /** 哪些错误值得重试（默认：网络类 + 5xx） */
  isRetryable?: (error: unknown) => boolean;
  /** 熔断器 key，不同 key 独立计数 */
  breakerKey?: string;
  /** 熔断器（共享） */
  breaker?: CircuitBreaker;
  /** 重试之间的日志回调 */
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
}

export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`操作超时（${ms}ms）`);
    this.name = 'TimeoutError';
  }
}

export class CircuitOpenError extends Error {
  constructor(key: string) {
    super(`熔断已打开：${key}`);
    this.name = 'CircuitOpenError';
  }
}

/** 默认判定：网络错误与 5xx 重试，4xx 不重试 */
export function defaultIsRetryable(error: unknown): boolean {
  if (error instanceof TimeoutError) return true;
  const msg = String((error as Error)?.message ?? error).toLowerCase();
  if (/abort|timeout|timed out|etimedout|econnreset|socket hang up|network|fetch failed/.test(msg)) return true;
  const code = (error as any)?.status ?? (error as any)?.statusCode ?? (error as any)?.retcode;
  if (typeof code === 'number') return code >= 500 || code === 429;
  return false;
}

/** 给任意 promise 加超时 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label = '操作'): Promise<T> {
  if (!Number.isFinite(ms) || ms <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(ms)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

export interface BreakerState {
  /** 连续失败次数 */
  failures: number;
  /** 打开的时间戳（毫秒） */
  openedAt?: number;
  /** 半开后成功则清零 */
  halfOpen?: boolean;
}

/**
 * 熔断器：连续失败达到阈值就打开，冷却期内直接拒绝；冷却结束进入半开，放一次探针。
 */
export class CircuitBreaker {
  private states = new Map<string, BreakerState>();

  constructor(
    /** 连续失败多少次就打开 */
    public readonly threshold = 5,
    /** 打开后多久允许半开探针（毫秒） */
    public readonly cooldownMs = 30_000,
  ) {}

  state(key: string): BreakerState {
    let s = this.states.get(key);
    if (!s) {
      s = { failures: 0 };
      this.states.set(key, s);
    }
    return s;
  }

  /** 是否可以尝试（不在熔断期，或已过半开） */
  canAttempt(key: string, now = Date.now()): boolean {
    const s = this.state(key);
    if (!s.openedAt) return true;
    if (now - s.openedAt >= this.cooldownMs) {
      s.halfOpen = true;
      return true;
    }
    return false;
  }

  onSuccess(key: string): void {
    const s = this.state(key);
    s.failures = 0;
    s.openedAt = undefined;
    s.halfOpen = false;
  }

  onFailure(key: string, now = Date.now()): void {
    const s = this.state(key);
    s.failures += 1;
    s.halfOpen = false;
    if (s.failures >= this.threshold) s.openedAt = now;
  }

  /** 手动复位 */
  reset(key: string): void {
    this.states.set(key, { failures: 0 });
  }

  /** 当前状态快照（给 /status 看） */
  snapshot(): Record<string, { failures: number; opened: boolean; openedAt?: number }> {
    const out: Record<string, { failures: number; opened: boolean; openedAt?: number }> = {};
    for (const [k, s] of this.states) {
      out[k] = { failures: s.failures, opened: Boolean(s.openedAt), ...(s.openedAt ? { openedAt: s.openedAt } : {}) };
    }
    return out;
  }
}

/** 指数退避 + 抖动 */
export function backoffDelay(attempt: number, base: number, max: number, random: () => number): number {
  const raw = base * Math.pow(2, Math.max(0, attempt - 1));
  const capped = Math.min(raw, max);
  // 抖动 ±25%，避免惊群
  const jitter = capped * 0.25 * (random() * 2 - 1);
  return Math.max(0, Math.round(capped + jitter));
}

/**
 * 带超时/重试/熔断地执行任务。
 * 全部失败后抛最后一个错误（调用方决定要不要进 DLQ）。
 */
export async function withResilience<T>(
  task: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const attempts = Math.max(1, options.attempts ?? 3);
  const base = options.backoffMs ?? 1_000;
  const maxBackoff = options.maxBackoffMs ?? 30_000;
  const random = options.random ?? Math.random;
  const isRetryable = options.isRetryable ?? defaultIsRetryable;
  const breaker = options.breaker;
  const key = options.breakerKey ?? 'default';

  if (breaker && !breaker.canAttempt(key)) throw new CircuitOpenError(key);

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await withTimeout(Promise.resolve().then(() => task(attempt)), timeoutMs);
      if (breaker) breaker.onSuccess(key);
      return result;
    } catch (error) {
      lastError = error;
      const canRetry = attempt < attempts && isRetryable(error);
      if (breaker) breaker.onFailure(key);
      if (!canRetry) break;
      const delayMs = backoffDelay(attempt, base, maxBackoff, random);
      options.onRetry?.({ attempt, delayMs, error });
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastError;
}

export interface DlqEntry {
  id: string;
  /** 失败任务类型 */
  kind: string;
  /** 原始载荷 */
  payload: unknown;
  /** 最后一次错误 */
  error: string;
  /** 重试次数 */
  attempts: number;
  createdAt: number;
  /** 上下文（如会话 id） */
  context?: Record<string, unknown>;
}

/** 死信队列：失败任务落盘，不丢消息 */
export class DeadLetterQueue {
  private file: string;
  private entries: DlqEntry[] = [];

  constructor(dir: string, private readonly max = 500) {
    this.file = join(dir, 'dlq.jsonl');
    this.load();
  }

  private load(): void {
    try {
      if (!existsSync(this.file)) return;
      this.entries = readFileSync(this.file, 'utf8')
        .split('\n')
        .filter((l) => l.trim() !== '')
        .map((l) => {
          try { return JSON.parse(l) as DlqEntry; } catch { return null; }
        })
        .filter((e): e is DlqEntry => e !== null);
    } catch {
      this.entries = [];
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const keep = this.entries.slice(-this.max);
    this.entries = keep;
    writeFileSync(this.file, keep.map((e) => JSON.stringify(e)).join('\n') + (keep.length ? '\n' : ''), 'utf8');
  }

  push(entry: Omit<DlqEntry, 'id' | 'createdAt'>): DlqEntry {
    const full: DlqEntry = {
      ...entry,
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: Date.now(),
    };
    this.entries.push(full);
    this.persist();
    return full;
  }

  all(): DlqEntry[] { return [...this.entries]; }
  get size(): number { return this.entries.length; }

  /** 取出一条并移除（重放用） */
  take(id: string): DlqEntry | null {
    const i = this.entries.findIndex((e) => e.id === id);
    if (i < 0) return null;
    const [entry] = this.entries.splice(i, 1);
    this.persist();
    return entry ?? null;
  }

  clear(): number {
    const n = this.entries.length;
    this.entries = [];
    this.persist();
    return n;
  }
}
