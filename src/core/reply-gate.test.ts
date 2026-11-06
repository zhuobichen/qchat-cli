import { describe, it, expect } from 'vitest';
import { buildGateBody, parseGateAnswer, rulesDecision, gateReply, GATE_CRITERIA, type GateContext, detectAbuse, decideSticker } from './reply-gate.js';

const ctx = (over: Partial<GateContext> = {}): GateContext => ({
  trigger: 'ambient',
  recent: ['张三: 今晚打不打', '李四: 打啊'],
  ...over,
});

describe('buildGateBody', () => {
  it('state 带触发原因与最近消息，问题给三个选项', () => {
    const body: any = buildGateBody(ctx({ trigger: 'mention' }));
    expect(body.model).toBe('jev-latest');
    expect(body.state).toContain('mention');
    expect(body.state).toContain('今晚打不打');
    expect(Object.keys(body.questions.m0.criteria)).toEqual(['reply', 'wait', 'skip']);
  });

  it('最多带 10 条最近消息', () => {
    const many = Array.from({ length: 20 }, (_, i) => `m${i}`);
    const body: any = buildGateBody(ctx({ recent: many }));
    expect(body.state).toContain('[#9] m19');
    expect(body.state).not.toContain('[#10]');
  });
});

describe('parseGateAnswer', () => {
  it('合法取值 + 置信度', () => {
    expect(parseGateAnswer({ answers: { m0: { choice: 'reply', confidence: 0.9 } } }))
      .toEqual({ decision: 'reply', confidence: 0.9 });
  });

  it('非法 choice 返回 null', () => {
    expect(parseGateAnswer({ answers: { m0: { choice: 'maybe' } } })).toBeNull();
    expect(parseGateAnswer({})).toBeNull();
  });

  it('缺置信度给 0.5', () => {
    expect(parseGateAnswer({ answers: { m0: { choice: 'skip' } } })?.confidence).toBe(0.5);
  });
});

describe('rulesDecision', () => {
  it('@我 必回', () => {
    expect(rulesDecision(ctx({ trigger: 'mention' })).decision).toBe('reply');
  });
  it('私聊必回', () => {
    expect(rulesDecision(ctx({ trigger: 'private' })).decision).toBe('reply');
  });
  it('路人闲聊默认不插话', () => {
    expect(rulesDecision(ctx()).decision).toBe('skip');
  });
});

describe('gateReply 回落', () => {
  const okFetch = (choice: string, confidence: number) =>
    (async () => ({ ok: true, json: async () => ({ answers: { m0: { choice, confidence } } }) } as any)) as unknown as typeof fetch;

  it('Jev 高置信时采用它的判断', async () => {
    const r = await gateReply(ctx(), { apiKey: 'k', fetchImpl: okFetch('reply', 0.92) });
    expect(r).toMatchObject({ decision: 'reply', source: 'jev', confidence: 0.92 });
  });

  it('Jev 低置信时回落到规则', async () => {
    const r = await gateReply(ctx(), { apiKey: 'k', fetchImpl: okFetch('reply', 0.3) });
    expect(r.source).toBe('rules');
    expect(r.decision).toBe('skip');   // ambient 的规则是 skip
    expect(r.reason).toContain('回落');
  });

  it('没配 key 直接走规则', async () => {
    const r = await gateReply(ctx({ trigger: 'mention' }), { apiKey: '' });
    expect(r).toMatchObject({ decision: 'reply', source: 'rules' });
  });

  it('接口报错走规则', async () => {
    const bad = (async () => ({ ok: false, status: 500 } as any)) as unknown as typeof fetch;
    expect((await gateReply(ctx({ trigger: 'mention' }), { apiKey: 'k', fetchImpl: bad })).decision).toBe('reply');
  });

  it('网络异常走规则', async () => {
    const boom = (async () => { throw new Error('x'); }) as unknown as typeof fetch;
    expect((await gateReply(ctx(), { apiKey: 'k', fetchImpl: boom })).source).toBe('rules');
  });

  it('Jev 说 skip 且高置信时尊重它', async () => {
    const r = await gateReply(ctx({ trigger: 'mention' }), { apiKey: 'k', fetchImpl: okFetch('skip', 0.8) });
    expect(r).toMatchObject({ decision: 'skip', source: 'jev' });
  });
});

describe('GATE_CRITERIA', () => {
  it('三个选项都有中文说明', () => {
    for (const k of ['reply', 'wait', 'skip'] as const) {
      expect(GATE_CRITERIA[k].length).toBeGreaterThan(5);
    }
  });
});

describe('GATE_CRITERIA 覆盖情绪共鸣', () => {
  it('reply 判据里明确包含吐槽/糗事/共鸣', () => {
    expect(GATE_CRITERIA.reply).toContain('吐槽');
    expect(GATE_CRITERIA.reply).toContain('共鸣');
  });

  it('skip 判据里包含事务通知与刷屏', () => {
    expect(GATE_CRITERIA.skip).toContain('事务');
    expect(GATE_CRITERIA.skip).toContain('刷屏');
  });
});

describe('阈值默认值', () => {
  it('未设环境变量时默认 0.55（0.45 会放过 @all 打吗 这类不该接的）', async () => {
    const saved = process.env.QCE_GATE_MIN_CONFIDENCE;
    delete process.env.QCE_GATE_MIN_CONFIDENCE;
    // 0.5 置信度应被拒（低于默认阈值）
    const fake = (async () => ({ ok: true, json: async () => ({ answers: { m0: { choice: 'reply', confidence: 0.5 } } }) } as any)) as unknown as typeof fetch;
    const r = await gateReply({ trigger: 'ambient', recent: ['x'] }, { apiKey: 'k', fetchImpl: fake });
    expect(r.source).toBe('rules');
    if (saved !== undefined) process.env.QCE_GATE_MIN_CONFIDENCE = saved;
  });
});

describe('groupSize 小群提示', () => {
  it('小群时 state 里带"多半是在对你说话"', () => {
    const body: any = buildGateBody({ trigger: 'ambient', recent: ['Todd: 你在干嘛'], groupSize: 2 });
    expect(body.state).toContain('很小的群');
    expect(body.state).toContain('多半是在对你说话');
  });

  it('大群时只写人数，不加倾向性提示', () => {
    const body: any = buildGateBody({ trigger: 'ambient', recent: ['x: y'], groupSize: 41 });
    expect(body.state).toContain('群人数：41');
    expect(body.state).not.toContain('很小的群');
  });

  it('不给 groupSize 时不写这一行', () => {
    const body: any = buildGateBody({ trigger: 'ambient', recent: ['x'] });
    expect(body.state).not.toContain('群人数');
  });
});

describe('detectAbuse 骂人识别', () => {
  const g = { groupSize: 2 };

  it('明确的第二人称辱骂 → 成立', () => {
    expect(detectAbuse('你是个傻逼', g)).toBe(true);
    expect(detectAbuse('我去你妈的', g)).toBe(true);
    expect(detectAbuse('你个智障', g)).toBe(true);
    expect(detectAbuse('你个废物', g)).toBe(true);
    // 「废物东西」没有第二人称指向，按设计不触发（防误判优先）
    expect(detectAbuse('废物东西', g)).toBe(false);
  });

  it('语气词不误判（"你妈的"作感叹用）', () => {
    expect(detectAbuse('你妈的我手机掉了', g)).toBe(false);
    expect(detectAbuse('我操，心态炸了', g)).toBe(false);
  });

  it('骂别的东西不算', () => {
    expect(detectAbuse('这游戏真垃圾', g)).toBe(false);
    expect(detectAbuse('傻逼游戏', g)).toBe(false);
    expect(detectAbuse('今天食堂真难吃', g)).toBe(false);
  });

  it('提到机器人也算指向我', () => {
    expect(detectAbuse('这机器人真废物', { groupSize: 41 })).toBe(true);
  });

  it('@ 我时即使没说"你"也算', () => {
    expect(detectAbuse('傻逼', { mentioned: true })).toBe(true);
  });

  it('大群里骂别人不算', () => {
    expect(detectAbuse('你是个傻逼', { groupSize: 41 })).toBe(true); // 有"你"，指向性强
    expect(detectAbuse('真垃圾', { groupSize: 41 })).toBe(false);
  });

  it('空输入', () => {
    expect(detectAbuse('')).toBe(false);
  });
});

describe('gateReply 被骂优先', () => {
  it('被骂时必回，且标记 abuse（优先于一切，包括不配 key）', async () => {
    const r = await gateReply({ trigger: 'ambient', recent: ['Todd: 你是个傻逼'], groupSize: 2 }, { apiKey: '' });
    expect(r.decision).toBe('reply');
    expect(r.abuse).toBe(true);
    expect(r.source).toBe('rules');
  });

  it('正常消息不会被标记 abuse', async () => {
    const fake = (async () => ({ ok: true, json: async () => ({ answers: { m0: { choice: 'skip', confidence: 0.9 } } }) } as any)) as unknown as typeof fetch;
    const r = await gateReply({ trigger: 'ambient', recent: ['Todd: 在吗'], groupSize: 2 }, { apiKey: 'k', fetchImpl: fake });
    expect(r.abuse).toBeUndefined();
  });

  it('从 recent 里去掉昵称前缀再判断', async () => {
    const r = await gateReply({ trigger: 'ambient', recent: ['冷峰沉睡: 你是个傻逼'], groupSize: 2 }, { apiKey: '' });
    expect(r.abuse).toBe(true);
  });
});

describe('decideSticker 配图判断', () => {
  const ok = (choice: string, conf: number, mood = 'laugh') =>
    (async () => ({ ok: true, json: async () => ({ answers: { m0: { choice, confidence: conf }, m1: { choice: mood } } }) } as any)) as unknown as typeof fetch;

  it('Jev 说该配 → add 且带情绪词', async () => {
    const d = await decideSticker('哈哈哈哈哈太惨了', { recent: ['a: b'] }, { apiKey: 'k', fetchImpl: ok('add', 0.9, 'laugh') });
    expect(d.add).toBe(true);
    expect(d.mood).toBe('笑哭');
    expect(d.source).toBe('jev');
  });

  it('Jev 说不配 → add=false', async () => {
    const d = await decideSticker('这个函数要在 3000 端口调用', {}, { apiKey: 'k', fetchImpl: ok('skip', 0.95) });
    expect(d.add).toBe(false);
    expect(d.source).toBe('jev');
  });

  it('置信度不够 → 回落随机', async () => {
    const d = await decideSticker('随便', {}, { apiKey: 'k', fetchImpl: ok('add', 0.2), minConfidence: 0.55 });
    expect(d.source).toBe('random');
  });

  it('无 key → 回落随机', async () => {
    const d = await decideSticker('随便', {}, { apiKey: '' });
    expect(d.source).toBe('random');
  });

  it('请求失败 → 回落随机', async () => {
    const boom = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    const d = await decideSticker('随便', {}, { apiKey: 'k', fetchImpl: boom });
    expect(d.source).toBe('random');
  });

  it('各情绪映射正确', async () => {
    const cases: Array<[string, string]> = [
      ['laugh', '笑哭'], ['speechless', '无语'], ['angry', '生气'],
      ['sad', '委屈'], ['slack', '摆烂'], ['smug', '嘲讽'], ['shock', '震惊'],
    ];
    for (const [key, word] of cases) {
      const d = await decideSticker('x', {}, { apiKey: 'k', fetchImpl: ok('add', 0.9, key) });
      expect(d.mood).toBe(word);
    }
  });
});
