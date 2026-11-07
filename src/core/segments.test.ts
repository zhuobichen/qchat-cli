import { describe, it, expect } from 'vitest';

import { isSplittable, segmentReply, splitReply } from './segments.js';

describe('segments 分段回复', () => {
  it('短句不拆', () => {
    const r = segmentReply('行。先交需求文档。');
    expect(r.segments).toHaveLength(1);
    expect(r.reason).toContain('太短');
  });

  it('中等长度按句号拆', () => {
    const r = segmentReply('抗压吧我去过。但那不是教你怎么对话，是教你怎么把对话变成对线。');
    expect(r.segments.length).toBeGreaterThan(1);
    expect(r.segments.map((s) => s.text).join('')).toContain('抗压吧');
  });

  it('段落之间都有停顿时间，最后一段为 0', () => {
    const r = segmentReply('第一句话在这里。第二句想说的东西。第三句补充一下。');
    const last = r.segments[r.segments.length - 1];
    expect(last.delayAfterMs).toBe(0);
    if (r.segments.length > 1) {
      expect(r.segments[0].delayAfterMs).toBeGreaterThan(0);
    }
  });

  it('「不是A而是B」不被拆散', () => {
    const r = segmentReply('这不是钱的问题，而是时间的问题。');
    expect(r.segments).toHaveLength(1);
  });

  it('逗号后面接连接词不拆', () => {
    const r = segmentReply('我想去，但是没时间。那就下次吧再说了。');
    for (const s of r.segments) {
      expect(s.text.startsWith('但是')).toBe(false);
    }
  });

  it('代码块不拆', () => {
    const r = segmentReply('看这个 ```const a = 1;``` 就这样。再加一句凑长度。');
    expect(r.segments).toHaveLength(1);
    expect(r.reason).toContain('代码块');
  });

  it('含链接不拆', () => {
    const r = segmentReply('地址在这 https://example.com/abc 你自己看吧。');
    expect(r.segments).toHaveLength(1);
    expect(r.reason).toContain('链接');
  });

  it('列表不拆', () => {
    const r = segmentReply('- 第一条\n- 第二条\n- 第三条');
    expect(r.segments).toHaveLength(1);
    expect(r.reason).toContain('列表');
  });

  it('超长不拆（整段更好读）', () => {
    const long = '这是一句话。'.repeat(50);
    const r = segmentReply(long);
    expect(r.segments).toHaveLength(1);
    expect(r.reason).toContain('太长');
  });

  it('最多拆 3 段', () => {
    const text = '第一段。第二段。第三段。第四段。第五段内容也够了。';
    const r = splitReply(text, { maxSegments: 3 });
    expect(r.segments.length).toBeLessThanOrEqual(3);
  });

  it('拆分后内容不丢字', () => {
    const text = '抗压吧我去过。但那不是教你怎么对话，是教你怎么把对话变成对线。';
    const r = splitReply(text);
    const joined = r.segments.map((s) => s.text).join('');
    expect(joined.replace(/\s/g, '')).toBe(text.replace(/\s/g, ''));
  });

  it('空输入返回空', () => {
    expect(segmentReply('').segments).toEqual([]);
  });

  it('isSplittable 认得出引用', () => {
    expect(isSplittable('> 引用一段话\n然后我说话').ok).toBe(false);
  });

  it('多分号像清单，不拆', () => {
    expect(isSplittable('一；二；三；四').ok).toBe(false);
  });

  it('正常两句可以拆', () => {
    expect(isSplittable('第一句话在这里。第二句话也在。').ok).toBe(true);
  });
});
