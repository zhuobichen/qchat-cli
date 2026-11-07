import { describe, it, expect } from 'vitest';

import { humanize, aiSmellScore } from './humanize.js';

describe('humanize 去人机味', () => {
  it('删掉句首连接词', () => {
    const r = humanize('首先，这个问题很复杂。其次，我们得考虑成本。');
    expect(r.text).not.toContain('首先');
    expect(r.text).not.toContain('其次');
    expect(r.text).toContain('这个问题很复杂');
  });

  it('删掉结尾总结段', () => {
    const r = humanize('这事得看情况。\n\n总结一下：没有标准答案。');
    expect(r.text).not.toContain('总结一下');
    expect(r.text).not.toContain('没有标准答案');
    expect(r.text).toContain('这事得看情况');
  });

  it('总结段没冒号也删', () => {
    const r = humanize('先做 MVP 吧。\n\n总的来说建议先做 MVP。');
    expect(r.text).not.toContain('总的来说');
  });

  it('删客服腔', () => {
    const r = humanize('作为 AI，我理解你的疑问。如果你还有其他问题，随时可以问我。');
    expect(r.text).not.toContain('作为 AI');
    expect(r.text).not.toContain('随时可以问');
  });

  it('去掉 bullet 和粗体', () => {
    const r = humanize('- **第一点**：成本\n- 第二点：时间');
    expect(r.text).not.toContain('**');
    expect(r.text).not.toContain('- ');
  });

  it('删表格', () => {
    const r = humanize('看这个：\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n就这样。');
    expect(r.text).not.toContain('|');
  });

  it('「最后一波」不被误删（短连接词必须带标点）', () => {
    const r = humanize('最后一波团战，我直接冲了。');
    expect(r.text).toContain('最后一波');
  });

  it('「另外一个人」不被误删', () => {
    const r = humanize('另外一个人也来了。');
    expect(r.text).toContain('另外一个人');
  });

  it('连着的两个连接词都能删（多轮清理）', () => {
    const r = humanize('此外，还有一点值得注意的是团队的执行力。');
    expect(r.text).not.toContain('此外');
    expect(r.text).not.toContain('还有一点值得注意的是');
  });

  it('人话原样保留', () => {
    const src = '这题我熟。雪乃是答案，由比滨是手艺。';
    expect(humanize(src).text).toBe(src);
  });

  it('我实际发过的那种话不被改坏', () => {
    const src = '骂先记账。\n\n"偷腥"这词用错了。偷腥是背着人抢。惠抢过什么？她什么都没抢。';
    expect(humanize(src).text).toBe(src);
  });

  it('超长截断到最后一个句号', () => {
    const long = '第一句话在这里。'.repeat(40);
    const r = humanize(long, { maxChars: 100 });
    expect(r.text.length).toBeLessThanOrEqual(100);
    expect(r.text.endsWith('。')).toBe(true);
  });

  it('空输入不炸', () => {
    expect(humanize('').text).toBe('');
  });
});

describe('aiSmellScore 人机味打分', () => {
  it('典型 AI 回复分高', () => {
    const s = aiSmellScore('首先，A。其次，B。\n\n- x\n- y\n\n总结一下：C。');
    expect(s.score).toBeGreaterThan(5);
    expect(s.reasons.length).toBeGreaterThan(0);
  });

  it('人话分低', () => {
    expect(aiSmellScore('行。先交需求文档。').score).toBe(0);
  });

  it('表格和标题都算症状', () => {
    const s = aiSmellScore('# 标题\n\n| a | b |\n| --- | --- |\n| 1 | 2 |');
    expect(s.score).toBeGreaterThan(0);
  });

  it('客服腔算症状', () => {
    const s = aiSmellScore('作为 AI，希望对你有帮助。');
    expect(s.score).toBeGreaterThan(0);
  });
});
