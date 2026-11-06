import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  withTimeout, withResilience, CircuitBreaker, CircuitOpenError, TimeoutError,
  DeadLetterQueue, backoffDelay, defaultIsRetryable,
} from './reliability.js';

describe('withTimeout', () => {
  it('正常完成就返回', async () => {
    expect(await withTimeout(Promise.resolve(42), 1000)).toBe(42);
  });

  it('超时抛 TimeoutError', async () => {
    await expect(withTimeout(new Promise(() => {}), 50)).rejects.toBeInstanceOf(TimeoutError);
  });

  it('timeoutMs<=0 时不设限', async () => {
    expect(await withTimeout(Promise.resolve('x'), 0)).toBe('x');
  });
});

describe('backoffDelay', () => {
  it('指数增长并有上限', () => {
    const r = () => 0.5;
    expect(backoffDelay(1, 1000, 30000, r)).toBe(1000);
    expect(backoffDelay(2, 1000, 30000, r)).toBe(2000);
    expect(backoffDelay(10, 1000, 30000, r)).toBeLessThanOrEqual(30000);
  });

  it('抖动在 ±25% 内', () => {
    expect(backoffDelay(1, 1000, 30000, () => 0)).toBe(750);
    expect(backoffDelay(1, 1000, 30000, () => 1)).toBe(1250);
  });
});

describe('defaultIsRetryable', () => {
  it('超时与网络错可重试', () => {
    expect(defaultIsRetryable(new TimeoutError(10))).toBe(true);
    expect(defaultIsRetryable(new Error('fetch failed'))).toBe(true);
  });
  it('4xx 不重试', () => {
    expect(defaultIsRetryable(Object.assign(new Error('bad'), { status: 400 }))).toBe(false);
  });
  it('5xx 重试', () => {
    expect(defaultIsRetryable(Object.assign(new Error('boom'), { status: 503 }))).toBe(true);
  });
});

describe('withResilience', () => {
  it('第一次成功直接返回', async () => {
    const task = vi.fn(async () => 'ok');
    expect(await withResilience(task, { attempts: 3 })).toBe('ok');
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('失败后重试成功', async () => {
    let n = 0;
    const out = await withResilience(async () => {
      n += 1;
      if (n < 3) throw new Error('fetch failed');
      return 'ok';
    }, { attempts: 3, backoffMs: 1, maxBackoffMs: 2 });
    expect(out).toBe('ok');
    expect(n).toBe(3);
  });

  it('全部失败抛最后的错', async () => {
    let n = 0;
    await expect(withResilience(async () => { n += 1; throw new Error('fetch failed'); },
      { attempts: 2, backoffMs: 1 })).rejects.toThrow('fetch failed');
    expect(n).toBe(2);
  });

  it('不可重试的错误只试一次', async () => {
    let n = 0;
    await expect(withResilience(async () => { n += 1; throw Object.assign(new Error('bad'), { status: 400 }); },
      { attempts: 3, backoffMs: 1 })).rejects.toThrow();
    expect(n).toBe(1);
  });

  it('onRetry 被调用', async () => {
    const seen: number[] = [];
    await expect(withResilience(async () => { throw new Error('fetch failed'); },
      { attempts: 2, backoffMs: 1, onRetry: (i) => seen.push(i.attempt) })).rejects.toThrow();
    expect(seen).toEqual([1]);
  });
});

describe('CircuitBreaker', () => {
  it('连续失败到阈值就打开', () => {
    const b = new CircuitBreaker(3, 1000);
    for (let i = 0; i < 3; i += 1) b.onFailure('k');
    expect(b.canAttempt('k')).toBe(false);
    expect(b.snapshot().k.opened).toBe(true);
  });

  it('成功后清零', () => {
    const b = new CircuitBreaker(2, 1000);
    b.onFailure('k');
    b.onSuccess('k');
    expect(b.state('k').failures).toBe(0);
    expect(b.canAttempt('k')).toBe(true);
  });

  it('冷却后允许半开', () => {
    const b = new CircuitBreaker(2, 1000);
    b.onFailure('k'); b.onFailure('k');
    expect(b.canAttempt('k', Date.now())).toBe(false);
    expect(b.canAttempt('k', Date.now() + 2000)).toBe(true);
  });

  it('不同 key 互不影响', () => {
    const b = new CircuitBreaker(1, 1000);
    b.onFailure('a');
    expect(b.canAttempt('b')).toBe(true);
  });

  it('熔断打开时 withResilience 直接抛 CircuitOpenError', async () => {
    const b = new CircuitBreaker(1, 60000);
    b.onFailure('k');
    await expect(withResilience(async () => 'x', { breaker: b, breakerKey: 'k' }))
      .rejects.toBeInstanceOf(CircuitOpenError);
  });
});

describe('DeadLetterQueue', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'qce-dlq-')); });
  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* sandbox */ } });

  it('push 后能读回', () => {
    const q = new DeadLetterQueue(dir);
    q.push({ kind: 'send', payload: { text: 'hi' }, error: 'boom', attempts: 3 });
    expect(q.size).toBe(1);
    expect(q.all()[0]).toMatchObject({ kind: 'send', error: 'boom', attempts: 3 });
  });

  it('take 会移除', () => {
    const q = new DeadLetterQueue(dir);
    const e = q.push({ kind: 'send', payload: {}, error: 'x', attempts: 1 });
    expect(q.take(e.id)).not.toBeNull();
    expect(q.size).toBe(0);
  });

  it('take 不存在的 id 返回 null', () => {
    expect(new DeadLetterQueue(dir).take('nope')).toBeNull();
  });

  it('跨实例持久化', () => {
    const q1 = new DeadLetterQueue(dir);
    q1.push({ kind: 'a', payload: {}, error: 'e', attempts: 1 });
    expect(new DeadLetterQueue(dir).size).toBe(1);
  });

  it('clear 清空', () => {
    const q = new DeadLetterQueue(dir);
    q.push({ kind: 'a', payload: {}, error: 'e', attempts: 1 });
    expect(q.clear()).toBe(1);
    expect(q.size).toBe(0);
  });
});
