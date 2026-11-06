import { describe, it, expect } from 'vitest';
import { parseMemeToolResult, searchMemes } from './memesource.js';

const payload = (results: any[]) => ({
  result: { content: [{ type: 'text', text: JSON.stringify({ total: results.length, results }) }] },
});

describe('parseMemeToolResult', () => {
  it('解析 image_url 列表', () => {
    const out = parseMemeToolResult(payload([
      { title: 'Facepalm', image_url: 'https://x/a.jpg', commercial_use: false },
      { title: 'Cat', image_url: 'https://x/b.jpg', commercial_use: true, credit: 'CC0' },
    ]));
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ title: 'Facepalm', url: 'https://x/a.jpg', commercialUse: false });
    expect(out[1].credit).toBe('CC0');
  });

  it('字段名兜底（url / image）', () => {
    const out = parseMemeToolResult(payload([{ name: 'A', url: 'https://x/1.jpg' }, { name: 'B', image: 'https://x/2.jpg' }]));
    expect(out.map((r) => r.url)).toEqual(['https://x/1.jpg', 'https://x/2.jpg']);
  });

  it('没有 url 的条目被丢弃', () => {
    expect(parseMemeToolResult(payload([{ title: 'x' }, { title: 'y', image_url: 'https://x/y.jpg' }]))).toHaveLength(1);
  });

  it('结构不对返回空数组', () => {
    expect(parseMemeToolResult({})).toEqual([]);
    expect(parseMemeToolResult({ result: { content: [] } })).toEqual([]);
    expect(parseMemeToolResult({ result: { content: [{ type: 'text', text: 'not json' }] } })).toEqual([]);
  });
});

describe('searchMemes', () => {
  it('成功返回解析后的结果', async () => {
    const fake = (async () => ({
      ok: true,
      json: async () => payload([{ title: 'Cat', image_url: 'https://x/c.jpg' }]),
    } as any)) as unknown as typeof fetch;
    const out = await searchMemes('cat', { fetchImpl: fake });
    expect(out).toHaveLength(1);
  });

  it('空 query 不发请求', async () => {
    let called = false;
    const fake = (async () => { called = true; return { ok: true, json: async () => payload([]) } as any; }) as unknown as typeof fetch;
    expect(await searchMemes('   ', { fetchImpl: fake })).toEqual([]);
    expect(called).toBe(false);
  });

  it('HTTP 错误返回空', async () => {
    const fake = (async () => ({ ok: false, status: 406 } as any)) as unknown as typeof fetch;
    expect(await searchMemes('cat', { fetchImpl: fake })).toEqual([]);
  });

  it('网络异常返回空', async () => {
    const fake = (async () => { throw new Error('x'); }) as unknown as typeof fetch;
    expect(await searchMemes('cat', { fetchImpl: fake })).toEqual([]);
  });
});
