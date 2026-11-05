import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MessageStore, type StoredMessage } from './message-store.js';

function msg(id: string, time: number, text = '内容'): StoredMessage {
  return { id, groupId: 100, time, senderId: 1, senderName: '张三', text };
}

describe('MessageStore', () => {
  let root: string;
  let store: MessageStore;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'qce-store-'));
    store = new MessageStore(root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('空索引返回空数组与水印 0', () => {
    expect(store.load(100)).toEqual([]);
    expect(store.watermark(100)).toBe(0);
    expect(store.stats()).toEqual([]);
  });

  it('merge 追加消息并按时间排序', () => {
    const r = store.merge(100, [msg('b', 200), msg('a', 100)]);
    expect(r).toEqual({ added: 2, total: 2 });
    expect(store.load(100).map((m) => m.id)).toEqual(['a', 'b']);
    expect(store.watermark(100)).toBe(200);
  });

  it('重复 id 幂等，只算新增', () => {
    store.merge(100, [msg('a', 100), msg('b', 200)]);
    const r = store.merge(100, [msg('a', 100), msg('b', 200), msg('c', 300)]);
    expect(r).toEqual({ added: 1, total: 3 });
    expect(store.load(100)).toHaveLength(3);
  });

  it('坏行不影响其它数据', () => {
    store.merge(100, [msg('a', 100)]);
    writeFileSync(join(root, 'group-100.jsonl'), `${JSON.stringify(msg('a', 100))}\n{not json}\n`, 'utf8');
    const loaded = store.load(100);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe('a');
  });

  it('按群隔离，loadAll 汇总', () => {
    store.merge(100, [msg('a', 100)]);
    store.merge(200, [{ ...msg('b', 150), groupId: 200 }]);
    expect(store.load(100)).toHaveLength(1);
    expect(store.load(200)).toHaveLength(1);
    expect(store.loadAll()).toHaveLength(2);
    expect(store.stats().map((s) => s.groupId).sort()).toEqual([100, 200]);
  });

  it('clear 单群与全清', () => {
    store.merge(100, [msg('a', 100)]);
    store.merge(200, [{ ...msg('b', 150), groupId: 200 }]);
    store.clear(100);
    expect(store.load(100)).toEqual([]);
    expect(store.load(200)).toHaveLength(1);
    store.clear();
    expect(store.stats()).toEqual([]);
  });

  it('忽略非 group 文件名', () => {
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'notes.txt'), 'x', 'utf8');
    expect(store.stats()).toEqual([]);
  });
});
