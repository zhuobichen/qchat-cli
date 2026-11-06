import { describe, it, expect } from 'vitest';
import { rulesMedium, decideMedium, buildMediumBody, parseMediumAnswer } from './reply-medium.js';

describe('rulesMedium', () => {
  it('默认文字', () => {
    expect(rulesMedium({ reply: '好的' }).medium).toBe('text');
  });

  it('对方发语音 → 回语音', () => {
    expect(rulesMedium({ reply: '收到', incomingIsVoice: true }).medium).toBe('voice');
  });

  it('要求唱歌 → 语音', () => {
    expect(rulesMedium({ reply: '好', incomingText: '唱个歌呗' }).medium).toBe('voice');
  });

  it('说"听听你的声音" → 语音', () => {
    expect(rulesMedium({ reply: '好', incomingText: '我想听听你的声音' }).medium).toBe('voice');
  });

  it('明确要求打字 → 文字（优先于语音触发）', () => {
    const d = rulesMedium({ reply: '好', incomingText: '别发语音，打字回我', incomingIsVoice: true });
    expect(d.medium).toBe('text');
    expect(d.reason).toContain('打字');
  });

  it('对方发图片 → 文字', () => {
    expect(rulesMedium({ reply: '看到了', incomingIsImage: true }).medium).toBe('text');
  });
});

describe('buildMediumBody / parseMediumAnswer', () => {
  it('请求体含对方类型与内容', () => {
    const body: any = buildMediumBody({ reply: '我在', incomingText: '在吗', incomingIsVoice: false });
    expect(body.model).toBe('jev-latest');
    expect(body.state).toContain('在吗');
    expect(Object.keys(body.questions.m0.criteria)).toEqual(['text', 'voice']);
  });

  it('解析合法答案', () => {
    expect(parseMediumAnswer({ answers: { m0: { choice: 'voice', confidence: 0.9 } } }))
      .toEqual({ medium: 'voice', confidence: 0.9 });
  });

  it('非法答案返回 null', () => {
    expect(parseMediumAnswer({ answers: { m0: { choice: 'x' } } })).toBeNull();
  });
});

describe('decideMedium', () => {
  it('硬规则命中语音时不再问模型', async () => {
    let called = false;
    const fake = (async () => { called = true; return { ok: true, json: async () => ({}) } as any; }) as unknown as typeof fetch;
    const d = await decideMedium({ reply: '好', incomingIsVoice: true }, { apiKey: 'k', fetchImpl: fake });
    expect(d.medium).toBe('voice');
    expect(called).toBe(false);
  });

  it('无 key 时走规则（文字）', async () => {
    const d = await decideMedium({ reply: '好' }, { apiKey: '' });
    expect(d.medium).toBe('text');
  });

  it('Jev 高置信语音则用语音', async () => {
    const fake = (async () => ({ ok: true, json: async () => ({ answers: { m0: { choice: 'voice', confidence: 0.9 } } }) } as any)) as unknown as typeof fetch;
    const d = await decideMedium({ reply: '好的', incomingText: '在吗' }, { apiKey: 'k', fetchImpl: fake });
    expect(d.medium).toBe('voice');
    expect(d.source).toBe('jev');
  });

  it('Jev 低置信回落文字', async () => {
    const fake = (async () => ({ ok: true, json: async () => ({ answers: { m0: { choice: 'voice', confidence: 0.3 } } }) } as any)) as unknown as typeof fetch;
    const d = await decideMedium({ reply: '好的' }, { apiKey: 'k', fetchImpl: fake });
    expect(d.medium).toBe('text');
    expect(d.reason).toContain('把握');
  });

  it('接口报错回落文字', async () => {
    const fake = (async () => ({ ok: false, status: 500 } as any)) as unknown as typeof fetch;
    expect((await decideMedium({ reply: 'x' }, { apiKey: 'k', fetchImpl: fake })).medium).toBe('text');
  });
});

describe('斗图：收到表情包回表情', () => {
  it('对方发表情包 → medium 为 sticker', () => {
    const d = rulesMedium({ reply: '哈哈', incomingText: '', incomingIsSticker: true });
    expect(d.medium).toBe('sticker');
    expect(d.reason).toContain('斗图');
  });

  it('表情包优先于默认文字', () => {
    expect(rulesMedium({ reply: 'x', incomingIsSticker: true }).medium).toBe('sticker');
  });

  it('对方发语音仍然回语音（语音优先）', () => {
    const d = rulesMedium({ reply: 'x', incomingIsVoice: true, incomingIsSticker: true });
    expect(d.medium).toBe('voice');
  });

  it('对方要求打字时不发表情', () => {
    const d = rulesMedium({ reply: 'x', incomingText: '别发表情，打字', incomingIsSticker: true });
    expect(d.medium).toBe('text');
  });

  it('普通图片（不是表情包）不回表情', () => {
    const d = rulesMedium({ reply: 'x', incomingIsSticker: false });
    expect(d.medium).toBe('text');
  });
});
