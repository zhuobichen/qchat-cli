import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadState, saveStateAtomic, advanceCursor, isNewMessage, summarize, emptyState,
} from '../../private/lib/watch-state.mjs';

describe('状态读写与断点续传', () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'qce-wstate-'));
    path = join(dir, 'state.json');
  });
  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* sandbox */ } });

  it('文件不存在时返回空状态', () => {
    expect(loadState(path).state).toEqual(emptyState());
  });

  it('原子写入后能读回', () => {
    const s = emptyState();
    s.cursors.p1 = { lastTime: 123 };
    saveStateAtomic(path, s);
    expect(loadState(path).state.cursors.p1.lastTime).toBe(123);
  });

  it('写入不留下 .tmp 残留', () => {
    saveStateAtomic(path, emptyState());
    expect(readdirSync(dir).filter((f) => f.includes('.tmp-'))).toHaveLength(0);
  });

  it('v1 状态自动迁移到 v2（保留水位）', () => {
    writeFileSync(path, JSON.stringify({ lastTime: { p1473517806: 999 }, seen: { a: 1 } }), 'utf8');
    const { state } = loadState(path);
    expect(state.version).toBe(2);
    expect(state.cursors.p1473517806.lastTime).toBe(999);
    expect(state.seen.a).toBe(1);
  });

  it('状态文件损坏时备份并返回空状态（不抛）', () => {
    writeFileSync(path, '{ broken json', 'utf8');
    const { state, recoveredFrom } = loadState(path);
    expect(state.cursors).toEqual({});
    expect(recoveredFrom).toBeTruthy();
    expect(readdirSync(dir).some((f) => f.includes('.corrupt-'))).toBe(true);
  });

  it('seen 超过 5000 条会裁剪', () => {
    const s = emptyState();
    for (let i = 0; i < 5200; i += 1) s.seen[`id${i}`] = 1;
    saveStateAtomic(path, s);
    expect(Object.keys(loadState(path).state.seen).length).toBeLessThanOrEqual(5000);
  });
});

describe('水位推进与断点判定', () => {
  it('水位只前进不后退', () => {
    const s = emptyState();
    advanceCursor(s, 'p1', 100);
    advanceCursor(s, 'p1', 50);           // 乱序的旧消息
    expect(s.cursors.p1.lastTime).toBe(100);
  });

  it('message id 更大时推进', () => {
    const s = emptyState();
    advanceCursor(s, 'p1', 100, 5);
    advanceCursor(s, 'p1', 100, 9);
    expect(s.cursors.p1.lastMessageId).toBe(9);
  });

  it('重启后：比水位新算新消息', () => {
    const s = emptyState();
    advanceCursor(s, 'p1', 100);
    expect(isNewMessage(s, 'p1', 101)).toBe(true);
    expect(isNewMessage(s, 'p1', 100)).toBe(false);
    expect(isNewMessage(s, 'p1', 99)).toBe(false);
  });

  it('同一秒用 message id 区分', () => {
    const s = emptyState();
    advanceCursor(s, 'p1', 100, 5);
    expect(isNewMessage(s, 'p1', 100, 6)).toBe(true);
    expect(isNewMessage(s, 'p1', 100, 5)).toBe(false);
    expect(isNewMessage(s, 'p1', 100, 4)).toBe(false);
  });

  it('没见过的会话第一条算新', () => {
    expect(isNewMessage(emptyState(), 'new', 1)).toBe(true);
  });

  it('持久化后重启仍能判定（新会话不重投）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qce-wstate2-'));
    const path = join(dir, 'state.json');
    const s = emptyState();
    advanceCursor(s, 'p1', 500, 99);
    saveStateAtomic(path, s);

    const reloaded = loadState(path).state;     // 模拟重启
    expect(isNewMessage(reloaded, 'p1', 501)).toBe(true);
    expect(isNewMessage(reloaded, 'p1', 500, 99)).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('summarize', () => {
  it('统计会话数与队列长度', () => {
    const s = emptyState();
    s.cursors.a = { lastTime: 1 };
    s.cursors.b = { lastTime: 2 };
    s.pending = [1, 2, 3];
    const out = summarize(s);
    expect(out.sessions).toBe(2);
    expect(out.pending).toBe(3);
  });
});
