import { describe, it, expect } from 'vitest';
import {
  buildGateBody, parseGateAnswer, rulesDecision, gateReply, GATE_CRITERIA, type GateContext,
} from './reply-gate.js';

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
