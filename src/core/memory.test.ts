import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  decayedWeight, isExpired, recallMemories, filterByKeyword, memoryId, renderMemories,
  MemoryStore, type MemoryRecord,
} from './memory.js';

const DAY = 86400;
const NOW = 1_800_000_000;

function rec(over: Partial<MemoryRecord> = {}): MemoryRecord {
  return { id: 'a', scope: 'g1', text: '用户喜欢喝冰美式', createdAt: NOW, weight: 1, ...over };
}

describe('decayedWeight', () => {
  it('刚记住时等于基础权重', () => {
    expect(decayedWeight(rec(), { now: NOW })).toBeCloseTo(1, 6);
  });

  it('一个半衰期后减半', () => {
    const w = decayedWeight(rec({ createdAt: NOW - 30 * DAY }), { now: NOW, halfLifeSec: 30 * DAY });
    expect(w).toBeCloseTo(0.5, 3);
  });

  it('两个半衰期后剩四分之一', () => {
    const w = decayedWeight(rec({ createdAt: NOW - 60 * DAY }), { now: NOW, halfLifeSec: 30 * DAY });
    expect(w).toBeCloseTo(0.25, 3);
  });

  it('被召回后重新计时（复习效应）', () => {
    const r = rec({ createdAt: NOW - 60 * DAY, lastUsedAt: NOW - 1 * DAY });
    const w = decayedWeight(r, { now: NOW, halfLifeSec: 30 * DAY });
    expect(w).toBeGreaterThan(0.9);
  });

  it('权重高的衰减慢（相对）', () => {
    const a = decayedWeight(rec({ weight: 1, createdAt: NOW - 30 * DAY }), { now: NOW });
    const b = decayedWeight(rec({ weight: 0.5, createdAt: NOW - 30 * DAY }), { now: NOW });
    expect(a).toBeGreaterThan(b);
  });
});

describe('isExpired', () => {
  it('显式 expiresAt 优先', () => {
    expect(isExpired(rec({ expiresAt: NOW - 1 }), { now: NOW })).toBe(true);
    expect(isExpired(rec({ expiresAt: NOW + 100 }), { now: NOW })).toBe(false);
  });

  it('默认 TTL 180 天', () => {
    expect(isExpired(rec({ createdAt: NOW - 181 * DAY }), { now: NOW })).toBe(true);
    expect(isExpired(rec({ createdAt: NOW - 179 * DAY }), { now: NOW })).toBe(false);
  });
});

describe('recallMemories', () => {
  const records = [
    rec({ id: 'fresh', text: '新记住的', createdAt: NOW - 1 * DAY, weight: 1 }),
    rec({ id: 'old', text: '很久以前', createdAt: NOW - 120 * DAY, weight: 1 }),
    rec({ id: 'important', text: '很重要的事', createdAt: NOW - 120 * DAY, weight: 1, lastUsedAt: NOW - 2 * DAY }),
    rec({ id: 'other', text: '别的群', scope: 'g2', createdAt: NOW }),
  ];

  it('按衰减权重排序，旧的排后面', () => {
    const out = recallMemories(records, { now: NOW, halfLifeSec: 30 * DAY, scope: 'g1' });
    expect(out[0].id).toBe('fresh');
    expect(out.map((r) => r.id)).toContain('old');
  });

  it('被复习过的旧记忆能排到前面', () => {
    const out = recallMemories(records, { now: NOW, halfLifeSec: 30 * DAY });
    const idxImportant = out.findIndex((r) => r.id === 'important');
    const idxOld = out.findIndex((r) => r.id === 'old');
    expect(idxImportant).toBeLessThan(idxOld);
  });

  it('按 scope 隔离', () => {
    const out = recallMemories(records, { now: NOW, scope: 'g2' });
    expect(out.map((r) => r.id)).toEqual(['other']);
  });

  it('limit 生效', () => {
    expect(recallMemories(records, { now: NOW, limit: 2 })).toHaveLength(2);
  });

  it('低于阈值的被过滤', () => {
    const dying = [rec({ id: 'x', createdAt: NOW - 365 * DAY, weight: 0.1 })];
    expect(recallMemories(dying, { now: NOW, minWeight: 0.05 })).toHaveLength(0);
  });

  it('过期项不召回', () => {
    const expired = [rec({ id: 'e', expiresAt: NOW - 1 })];
    expect(recallMemories(expired, { now: NOW })).toHaveLength(0);
  });
});

describe('filterByKeyword / memoryId / renderMemories', () => {
  it('关键词匹配正文与标签', () => {
    const rs = [rec({ text: '喜欢冰美式', tags: ['饮食'] }), rec({ id: 'b', text: '养了一只猫' })];
    expect(filterByKeyword(rs, '美式').map((r) => r.id)).toEqual(['a']);
    expect(filterByKeyword(rs, '饮食').map((r) => r.id)).toEqual(['a']);
    expect(filterByKeyword(rs, '')).toHaveLength(2);
  });

  it('同 scope 同文本 id 稳定，不同 scope 不同', () => {
    expect(memoryId('g1', 'x')).toBe(memoryId('g1', 'x'));
    expect(memoryId('g1', 'x')).not.toBe(memoryId('g2', 'x'));
  });

  it('渲染带时间与权重', () => {
    const text = renderMemories([{ ...rec(), score: 0.8 }]);
    expect(text).toContain('长期记忆');
    expect(text).toContain('冰美式');
    expect(text).toContain('0.80');
  });

  it('空列表渲染空串', () => {
    expect(renderMemories([])).toBe('');
  });
});

describe('MemoryStore', () => {
  let root: string;

  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'qce-mem-')); });
  afterEach(() => { try { rmSync(root, { recursive: true, force: true }); } catch { /* 沙箱 */ } });

  it('remember 幂等', () => {
    const store = new MemoryStore(root);
    const a = store.remember({ scope: 'g1', text: '记住这个', createdAt: NOW, weight: 1 });
    const b = store.remember({ scope: 'g1', text: '记住这个', createdAt: NOW, weight: 1 });
    expect(a.added).toBe(true);
    expect(b.added).toBe(false);
    expect(store.load()).toHaveLength(1);
  });

  it('touch 刷新 lastUsedAt', () => {
    const store = new MemoryStore(root);
    const { record } = store.remember({ scope: 'g1', text: 'x', createdAt: NOW, weight: 1 });
    store.touch(record.id, NOW + 100);
    expect(store.load()[0].lastUsedAt).toBe(NOW + 100);
  });

  it('prune 掉过期项并返回数量', () => {
    const store = new MemoryStore(root);
    store.remember({ scope: 'g1', text: '旧', createdAt: NOW - 400 * DAY, weight: 1 });
    store.remember({ scope: 'g1', text: '新', createdAt: NOW, weight: 1 });
    expect(store.prune({ now: NOW })).toBe(1);
    expect(store.load()).toHaveLength(1);
  });
});
