import { describe, it, expect } from 'vitest';
import { parseHistoryFile, queryHistory, renderHistory } from './historyfile.js';

const sample = `群 913807639 共 3 条
时间范围: 2025/9/3 01:49:15 → 2026/10/21 23:56:55

2025-09-03 01:49:15  冷峰沉睡(1441816738)
    永野一夏呢？
2025-09-03 01:49:33  青春期彪儿不会遇上晟大爹(1473517806)
    没毛
    第二行正文
2026-10-21 23:56:55  冷峰沉睡(1441816738)
    晚安`;

describe('parseHistoryFile', () => {
  const r = parseHistoryFile(sample);

  it('读出群号与条数', () => {
    expect(r.groupId).toBe(913807639);
    expect(r.total).toBe(3);
  });

  it('解析出每条记录（含多行正文）', () => {
    expect(r.records).toHaveLength(3);
    expect(r.records[0]).toMatchObject({ nick: '冷峰沉睡', qq: 1441816738, text: '永野一夏呢？' });
    expect(r.records[1].text).toBe('没毛\n第二行正文');
  });

  it('时间转成秒级时间戳且递增', () => {
    expect(r.records[0].time).toBeLessThan(r.records[2].time);
  });

  it('空内容不炸', () => {
    expect(parseHistoryFile('').records).toEqual([]);
  });
});

describe('queryHistory', () => {
  const r = parseHistoryFile(sample);

  it('按关键词过滤（大小写不敏感）', () => {
    expect(queryHistory(r.records, { search: '没毛' })).toHaveLength(1);
    expect(queryHistory(r.records, { search: '不存在' })).toHaveLength(0);
  });

  it('按发言人过滤', () => {
    expect(queryHistory(r.records, { from: 1441816738 })).toHaveLength(2);
  });

  it('按时间过滤', () => {
    const since = r.records[1].time;
    expect(queryHistory(r.records, { since })).toHaveLength(2);
    expect(queryHistory(r.records, { until: since })).toHaveLength(2);
  });

  it('last 取最后 N 条，limit 取前 N 条', () => {
    expect(queryHistory(r.records, { last: 1 })[0].text).toBe('晚安');
    expect(queryHistory(r.records, { limit: 1 })[0].text).toBe('永野一夏呢？');
  });

  it('组合条件', () => {
    expect(queryHistory(r.records, { from: 1441816738, search: '晚' })).toHaveLength(1);
  });
});

describe('renderHistory', () => {
  it('渲染含时间、昵称、缩进正文', () => {
    const r = parseHistoryFile(sample);
    const text = renderHistory(r.records.slice(0, 1));
    expect(text).toContain('2025-09-03');
    expect(text).toContain('冷峰沉睡(1441816738)');
    expect(text).toContain('    永野一夏呢？');
  });

  it('空数组渲染空串', () => {
    expect(renderHistory([])).toBe('');
  });
});
