import { describe, it, expect } from 'vitest';
import { extractWords, extractCatchphrases, buildProfiles, renderProfiles } from './member-profile.js';
import type { HistoryRecord } from './historyfile.js';

const rec = (qq: number, nick: string, time: number, text: string): HistoryRecord =>
  ({ time, qq, nick, text });

describe('extractWords', () => {
  it('抽取中文 2-4 字滑窗，去停用词', () => {
    const w = extractWords('装甲冲击');
    expect(w).toContain('装甲');
    expect(w).toContain('冲击');
    expect(w).not.toContain('的');
  });

  it('去掉 [图片] [表情] 标记', () => {
    const w = extractWords('[图片] 冲击');
    expect(w).not.toContain('图片');
  });

  it('英文按单词切分并小写', () => {
    expect(extractWords('GG EZ')).toContain('gg');
  });
});

describe('extractCatchphrases', () => {
  it('重复出现的短句算口头禅', () => {
    const texts = ['没毛病', '没毛病', '没毛病', '别的'];
    expect(extractCatchphrases(texts)).toContain('没毛病');
  });

  it('只出现一次的不算', () => {
    expect(extractCatchphrases(['只一次'])).not.toContain('只一次');
  });
});

describe('buildProfiles', () => {
  const records = [
    rec(1, '甲', 1000, '冲击'),
    rec(2, '乙', 1010, '没毛病'),
    rec(1, '甲', 1020, '没毛病'),
    rec(2, '乙', 1030, '装甲冲击'),
    rec(1, '甲', 2000, '晚安'),
  ];

  it('按发言量排序，统计条数与昵称', () => {
    const p = buildProfiles(records);
    expect(p[0].qq).toBe(1);
    expect(p[0].messages).toBe(3);
    expect(p[0].nick).toBe('甲');
  });

  it('算出活跃时段', () => {
    const p = buildProfiles(records);
    expect(p[0].activeHours.length).toBeGreaterThan(0);
    expect(p[0].topHours.length).toBeGreaterThan(0);
  });

  it('算出互动对象（5 分钟内互相接话）', () => {
    const p = buildProfiles(records);
    const a = p.find((x) => x.qq === 1)!;
    expect(a.topPartners.map((x) => x.qq)).toContain(2);
  });

  it('members 过滤生效', () => {
    const p = buildProfiles(records, { members: [2] });
    expect(p).toHaveLength(1);
    expect(p[0].qq).toBe(2);
  });

  it('空记录返回空数组', () => {
    expect(buildProfiles([])).toEqual([]);
  });
});

describe('renderProfiles', () => {
  it('渲染含昵称、条数、爱说', () => {
    const text = renderProfiles(buildProfiles([rec(1, '甲', 1000, '装甲冲击')]));
    expect(text).toContain('群成员画像');
    expect(text).toContain('甲(1)');
    expect(text).toContain('爱说');
  });

  it('空画像渲染空串', () => {
    expect(renderProfiles([])).toBe('');
  });
});
