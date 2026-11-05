import { describe, it, expect } from 'vitest';
import { tokenize, makeSnippet, scoreDoc, searchDocs, renderHits, type SearchDoc } from './search-index.js';

function doc(id: string, time: string, text: string, extra: Partial<SearchDoc> = {}): SearchDoc {
  return {
    id,
    time: Math.floor(new Date(time).getTime() / 1000),
    senderId: 1,
    senderName: '张三',
    text,
    ...extra,
  };
}

describe('tokenize', () => {
  it('中文切二元组，单字保留', () => {
    expect(tokenize('开会')).toEqual(['开会']);
    expect(tokenize('今天开会')).toEqual(['今天', '天开', '开会']);
    expect(tokenize('好')).toEqual(['好']);
  });

  it('拉丁与数字按词切，大小写归一', () => {
    expect(tokenize('React 19 Beta')).toEqual(['react', '19', 'beta']);
  });

  it('混合文本同时出两类 token', () => {
    const t = tokenize('用 React 写群日报');
    expect(t).toContain('react');
    expect(t).toContain('群日');
  });
});

describe('scoreDoc', () => {
  it('完全命中覆盖率 1 高于部分命中', () => {
    const full = scoreDoc(doc('a', '2026-11-01T10:00:00', '明天开会'), ['明天', '开会']);
    const half = scoreDoc(doc('b', '2026-11-01T10:00:00', '明天再说'), ['明天', '开会']);
    expect(full).toBeGreaterThan(half);
  });

  it('不含任何查询 token 得 0', () => {
    expect(scoreDoc(doc('c', '2026-11-01T10:00:00', '无关内容'), ['开会'])).toBe(0);
  });

  it('空查询得 0', () => {
    expect(scoreDoc(doc('d', '2026-11-01T10:00:00', '随便'), [])).toBe(0);
  });
});

describe('searchDocs', () => {
  const docs: SearchDoc[] = [
    doc('1', '2026-11-01T09:00:00', '明天开会讨论方案', { groupId: 100, senderId: 1, senderName: '张三' }),
    doc('2', '2026-11-02T09:00:00', '会议材料我发群里了', { groupId: 100, senderId: 2, senderName: '李四' }),
    doc('3', '2026-11-03T09:00:00', '今晚打球吗', { groupId: 200, senderId: 1, senderName: '张三' }),
  ];

  it('命中并按分数排序', () => {
    const hits = searchDocs(docs, '开会');
    expect(hits).toHaveLength(1);
    expect(hits[0].id).toBe('1');
    expect(hits[0].snippet).toContain('开会');
  });

  it('按群过滤', () => {
    const hits = searchDocs(docs, '会', { groupId: 100 });
    expect(hits.every((h) => h.groupId === 100)).toBe(true);
  });

  it('按发送者过滤', () => {
    const hits = searchDocs(docs, '打', { senderId: 2 });
    expect(hits).toHaveLength(0);
  });

  it('按时间过滤', () => {
    const since = Math.floor(new Date('2026-11-02T00:00:00').getTime() / 1000);
    const hits = searchDocs(docs, '会', { since });
    expect(hits.every((h) => h.time >= since)).toBe(true);
  });

  it('limit 生效', () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      doc(String(i), '2026-11-01T09:00:00', `开会第${i}次`),
    );
    expect(searchDocs(many, '开会', { limit: 3 })).toHaveLength(3);
  });

  it('空查询返回空', () => {
    expect(searchDocs(docs, '   ')).toHaveLength(0);
  });
});

describe('makeSnippet', () => {
  it('长文本围绕命中位置截取并加省略号', () => {
    const long = `${'铺垫'.repeat(60)}关键结论在这里${'收尾'.repeat(60)}`;
    const s = makeSnippet(long, '关键结论');
    expect(s).toContain('关键结论');
    expect(s.startsWith('…')).toBe(true);
    expect(s.endsWith('…')).toBe(true);
  });

  it('短文本原样返回', () => {
    expect(makeSnippet('短消息', '短')).toBe('短消息');
  });
});

describe('renderHits', () => {
  it('无命中给出提示', () => {
    expect(renderHits([])).toBe('没有命中。');
  });

  it('渲染包含时间与片段', () => {
    const hits = searchDocs([doc('1', '2026-11-01T09:05:00', '明天开会')], '开会');
    const text = renderHits(hits);
    expect(text).toContain('2026-11-01 09:05');
    expect(text).toContain('开会');
  });
});
