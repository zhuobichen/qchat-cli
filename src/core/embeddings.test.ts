import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cosine, encodeVector, decodeVector, chunk, embedTexts, resolveApiKey } from './embeddings.js';

describe('cosine', () => {
  it('平行向量为 1，正交为 0', () => {
    expect(cosine([1, 0], [2, 0])).toBeCloseTo(1, 6);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0, 6);
  });

  it('反平行接近 -1', () => {
    expect(cosine([1, 0], [-1, 0])).toBeCloseTo(-1, 6);
  });

  it('零向量返回 0，不抛', () => {
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });
});

describe('向量编解码', () => {
  it('Float32 往返一致（含小数精度）', () => {
    const v = [0.1, -0.25, 3.5, 0];
    const back = decodeVector(encodeVector(v));
    expect(Array.from(back)).toEqual(Array.from(Float32Array.from(v)));
  });

  it('空向量可往返', () => {
    expect(decodeVector(encodeVector([]))).toHaveLength(0);
  });
});

describe('chunk', () => {
  it('按大小切分，末块可短', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('size 非法时至少 1 条一批', () => {
    expect(chunk([1, 2], 0)).toEqual([[1], [2]]);
  });
});

describe('embedTexts', () => {
  const cfg = { apiKey: 'k', endpoint: 'https://x/embed', model: 'text-embedding-v4', batchSize: 2 };

  it('分批调用并按顺序拼接结果', async () => {
    const calls: any[] = [];
    const fake = (async (_url: string, init: any) => {
      const body = JSON.parse(init.body);
      calls.push(body.input.length);
      return {
        ok: true,
        json: async () => ({ data: body.input.map((_: string, i: number) => ({ embedding: [i, 1] })) }),
      } as any;
    }) as unknown as typeof fetch;

    const out = await embedTexts(['a', 'b', 'c'], cfg, fake);
    expect(calls).toEqual([2, 1]);
    expect(out).toHaveLength(3);
  });

  it('缺少 key 直接抛错', async () => {
    await expect(embedTexts(['a'], { apiKey: '' })).rejects.toThrow(/key/);
  });

  it('HTTP 错误重试一次后抛出', async () => {
    let n = 0;
    const fake = (async () => {
      n += 1;
      return { ok: false, status: 500, text: async () => 'boom' } as any;
    }) as unknown as typeof fetch;
    await expect(embedTexts(['a'], cfg, fake)).rejects.toThrow(/500/);
    expect(n).toBe(2);
  });

  it('空输入不调用接口', async () => {
    let called = false;
    const fake = (async () => { called = true; return { ok: true, json: async () => ({ data: [] }) } as any; }) as unknown as typeof fetch;
    expect(await embedTexts([], cfg, fake)).toEqual([]);
    expect(called).toBe(false);
  });
});

describe('resolveApiKey', () => {
  it('优先 DASHSCOPE_API_KEY，其次 QCE_DASHSCOPE_KEY', () => {
    expect(resolveApiKey({ DASHSCOPE_API_KEY: 'a' } as any)).toBe('a');
    expect(resolveApiKey({ QCE_DASHSCOPE_KEY: 'b' } as any)).toBe('b');
    expect(resolveApiKey({} as any)).toBe('');
  });
});

import { VectorStore, topK } from './vector-store.js';

describe('VectorStore', () => {
  let root: string;
  let store: VectorStore;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'qce-vec-'));
    store = new VectorStore(root);
  });

  afterEach(() => {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* 沙箱下可能删不掉 */ }
  });

  it('空库返回空', () => {
    expect(store.load(1).size).toBe(0);
    expect(store.stats()).toEqual([]);
    expect(store.search(1, [1, 0])).toEqual([]);
  });

  it('upsert 后可读回且去重', () => {
    store.upsert(1, [{ id: 'a', vec: [1, 0] }, { id: 'b', vec: [0, 1] }]);
    expect(store.load(1).size).toBe(2);
    const r = store.upsert(1, [{ id: 'a', vec: [0.5, 0.5] }]);
    expect(r).toEqual({ added: 0, total: 2 });
    expect(store.load(1).get('a')![0]).toBeCloseTo(0.5, 6);
  });

  it('按余弦排序取 top-k', () => {
    store.upsert(1, [
      { id: 'near', vec: [1, 0.1] },
      { id: 'far', vec: [0.1, 1] },
    ]);
    const hits = store.search(1, [1, 0], 2);
    expect(hits[0].id).toBe('near');
    expect(hits[0].score).toBeGreaterThan(hits[1].score);
  });

  it('topK 纯函数可单测', () => {
    const m = new Map<string, number[]>([
      ['x', [1, 0]],
      ['y', [0, 1]],
    ]);
    expect(topK(m, [1, 0], 1)[0].id).toBe('x');
  });

  it('clear 单群与全清', () => {
    store.upsert(1, [{ id: 'a', vec: [1, 0] }]);
    store.upsert(2, [{ id: 'b', vec: [1, 0] }]);
    store.clear(1);
    expect(store.stats().map((s) => s.groupId)).toEqual([2]);
    store.clear();
    expect(store.stats()).toEqual([]);
  });
});
