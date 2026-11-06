import { describe, it, expect } from 'vitest';
import { buildJevBody, parseJevAnswer, chooseWithJev, pickSticker, candidatesFor, type StickerCandidate, bigrams, emotionHints } from './sticker.js';

const cands: StickerCandidate[] = [
  { id: 'a'.repeat(64), label: '开心 庆祝 撒花' },
  { id: 'b'.repeat(64), label: '无语 沉默 摊手' },
];

describe('buildJevBody', () => {
  it('把候选做进 criteria，state 带意图', () => {
    const body: any = buildJevBody('我想庆祝一下', cands);
    expect(body.model).toBe('jev-latest');
    expect(body.state).toContain('我想庆祝一下');
    expect(body.questions.m0.type).toBe('choice');
    expect(Object.keys(body.questions.m0.criteria)).toEqual(cands.map((c) => c.id));
    expect(body.questions.m0.criteria[cands[0].id]).toBe(cands[0].label);
  });

  it('空候选也能构造（不抛）', () => {
    const body: any = buildJevBody('x', []);
    expect(body.questions.m0.criteria).toEqual({});
  });
});

describe('parseJevAnswer', () => {
  it('解析合法 choice 与置信度', () => {
    const out = parseJevAnswer({ answers: { m0: { choice: cands[1].id, confidence: 0.87 } } }, cands);
    expect(out).toEqual({ id: cands[1].id, confidence: 0.87 });
  });

  it('choice 不在候选里判无效', () => {
    expect(parseJevAnswer({ answers: { m0: { choice: 'deadbeef' } } }, cands)).toBeNull();
  });

  it('缺字段判无效', () => {
    expect(parseJevAnswer({}, cands)).toBeNull();
    expect(parseJevAnswer(null, cands)).toBeNull();
  });

  it('置信度缺失时给 0.5 兜底', () => {
    const out = parseJevAnswer({ answers: { m0: { choice: cands[0].id } } }, cands);
    expect(out?.confidence).toBe(0.5);
  });
});

describe('chooseWithJev', () => {
  const okFetch = (choice: string, confidence = 0.9) =>
    (async () => ({ ok: true, json: async () => ({ answers: { m0: { choice, confidence } } }) } as any)) as unknown as typeof fetch;

  it('成功时返回 Jev 的选择', async () => {
    const out = await chooseWithJev('庆祝', cands, { apiKey: 'k', fetchImpl: okFetch(cands[0].id) });
    expect(out).toEqual({ id: cands[0].id, confidence: 0.9 });
  });

  it('没有 key 时不做请求', async () => {
    let called = false;
    const spy = (async () => { called = true; return { ok: true, json: async () => ({}) } as any; }) as unknown as typeof fetch;
    expect(await chooseWithJev('x', cands, { apiKey: '', fetchImpl: spy })).toBeNull();
    expect(called).toBe(false);
  });

  it('接口报错返回 null（交给兜底）', async () => {
    const bad = (async () => ({ ok: false, status: 500, json: async () => ({}) } as any)) as unknown as typeof fetch;
    expect(await chooseWithJev('x', cands, { apiKey: 'k', fetchImpl: bad })).toBeNull();
  });

  it('网络抛错返回 null', async () => {
    const boom = (async () => { throw new Error('timeout'); }) as unknown as typeof fetch;
    expect(await chooseWithJev('x', cands, { apiKey: 'k', fetchImpl: boom })).toBeNull();
  });

  it('空候选直接 null', async () => {
    expect(await chooseWithJev('x', [], { apiKey: 'k' })).toBeNull();
  });
});

describe('pickSticker 回退', () => {
  it('Jev 失败时回退关键词，source=keyword', async () => {
    const boom = (async () => { throw new Error('down'); }) as unknown as typeof fetch;
    // 依赖真实表情库；库里没有匹配时返回 null，也接受
    const out = await pickSticker('庆祝', { apiKey: 'k', fetchImpl: boom });
    if (out) expect(out.source).toBe('keyword');
    else expect(out).toBeNull();
  });
});

describe('candidatesFor', () => {
  it('最多返回 5 个，id 都是 64 位 hash', () => {
    const list = candidatesFor('表情');
    expect(list.length).toBeLessThanOrEqual(5);
    for (const c of list) expect(c.id).toMatch(/^[a-f0-9]{64}$/);
  });

  it('无关查询可能返回空', () => {
    expect(Array.isArray(candidatesFor('zzzz不存在的词zzzz'))).toBe(true);
  });
});

describe('pickStickerMerged（本地库 + memecub 一起挑）', () => {
  const fakeMemes = (items: Array<{ title: string; url: string }>) =>
    (async () => ({
      ok: true,
      json: async () => ({ result: { content: [{ type: 'text', text: JSON.stringify({ total: items.length, results: items }) }] } }),
    } as any)) as unknown as typeof fetch;

  it('候选里同时含本地与 memecub 两类', async () => {
    const { buildJevBody } = await import('./sticker.js');
    const merged = [
      { id: 'local-a', label: '本地表情', origin: 'local' as const },
      { id: 'meme:0', label: 'Mind Blown', origin: 'memecub' as const, remoteUrl: 'https://x/a.jpg' },
    ];
    const body: any = buildJevBody('mind blown', merged);
    expect(Object.keys(body.questions.m0.criteria)).toEqual(['local-a', 'meme:0']);
  });

  it('Jev 可以选到 memecub 的候选', async () => {
    const { parseJevAnswer } = await import('./sticker.js');
    const merged = [
      { id: 'local-a', label: '本地' },
      { id: 'meme:0', label: 'Mind Blown' },
    ];
    const ans = parseJevAnswer({ answers: { m0: { choice: 'meme:0', confidence: 0.9 } } }, merged);
    expect(ans?.id).toBe('meme:0');
  });

  it('memecub 失败时只用本地候选（不崩）', async () => {
    const { pickStickerMerged } = await import('./sticker.js');
    const boom = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    const r = await pickStickerMerged('无语', { apiKey: '', fetchImpl: boom });
    if (r) expect(r.origin).toBe('local');
  });
});

describe('bigrams 中文切词', () => {
  it('切成二元组', () => {
    expect(bigrams('笑死我')).toEqual(['笑死', '死我']);
  });

  it('去掉标点空白', () => {
    expect(bigrams('笑，死 我')).toEqual(['笑死', '死我']);
  });

  it('单字保留', () => {
    expect(bigrams('笑')).toEqual(['笑']);
  });

  it('空输入', () => {
    expect(bigrams('')).toEqual([]);
  });
});

describe('emotionHints 同义扩展', () => {
  it('"笑死我了"扩出笑相关词', () => {
    const h = emotionHints('笑死我了');
    expect(h).toContain('笑死我了');
    expect(h.some((x) => x.includes('笑'))).toBe(true);
  });

  it('"无语"扩出震惊/呆滞', () => {
    const h = emotionHints('无语了');
    expect(h).toContain('震惊');
  });

  it('无情绪词时只有原句', () => {
    expect(emotionHints('abc')).toEqual(['abc']);
  });
});

describe('candidatesFor 只返回真匹配', () => {
  it('匹配不上时返回空，而不是凑数', () => {
    expect(candidatesFor('zzzzzzqqqq')).toEqual([]);
  });

  it('"笑死我了"能找到笑类表情', () => {
    const c = candidatesFor('笑死我了');
    expect(c.length).toBeGreaterThan(0);
    expect(c.some((x) => /笑|哈哈/.test(x.label))).toBe(true);
  });

  it('"生气"能找到愤怒类表情', () => {
    const c = candidatesFor('生气');
    expect(c.some((x) => /生气|愤怒|怼/.test(x.label))).toBe(true);
  });

  it('结果不超过 limit', () => {
    expect(candidatesFor('笑死我了', 3).length).toBeLessThanOrEqual(3);
  });
});
