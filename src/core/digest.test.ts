import { describe, it, expect } from 'vitest';
import { buildDigest, renderDigestMarkdown, renderDigestText, type DigestMessage } from './digest.js';

function msg(time: string, id: number, name: string, text: string): DigestMessage {
  return { time: Math.floor(new Date(time).getTime() / 1000), senderId: id, senderName: name, text };
}

describe('buildDigest', () => {
  const messages: DigestMessage[] = [
    msg('2026-11-04T09:10:00', 1, '张三', '早，今天谁去开会？'),
    msg('2026-11-04T09:12:00', 1, '张三', '材料我发群里了'),
    msg('2026-11-04T09:15:00', 2, '李四', '收到，我看下 https://example.com/doc'),
    msg('2026-11-04T10:05:00', 3, '王五', '这是一条很长的消息，用来测试长文识别。'.repeat(4)),
    msg('2026-11-04T14:30:00', 2, '李四', '@全体成员 下午三点开会，别迟到'),
    msg('2026-11-04T14:31:00', 2, '李四', '[文件]会议纪要.pdf'),
  ];

  it('统计总数、参与人数，并按发言量排序', () => {
    const d = buildDigest(messages);
    expect(d.total).toBe(6);
    expect(d.participants).toBe(3);
    expect(d.speakers[0].name).toBe('李四');
    expect(d.speakers[0].count).toBe(3);
    expect(d.speakers[1].name).toBe('张三');
  });

  it('按小时聚合，时间范围正确', () => {
    const d = buildDigest(messages);
    expect(d.hourly[9]).toBe(3);
    expect(d.hourly[10]).toBe(1);
    expect(d.hourly[14]).toBe(2);
    expect(new Date(d.from * 1000).getHours()).toBe(9);
    expect(new Date(d.to * 1000).getHours()).toBe(14);
  });

  it('提取链接、@全体、以及值得回看的消息', () => {
    const d = buildDigest(messages);
    expect(d.links).toContain('https://example.com/doc');
    expect(d.mentions).toBe(1);
    const reasons = d.highlights.map((h) => h.reason);
    expect(reasons).toContain('link');
    expect(reasons).toContain('long');
    expect(reasons).toContain('mention');
    expect(reasons).toContain('file');
  });

  it('空消息不炸', () => {
    const d = buildDigest([]);
    expect(d.total).toBe(0);
    expect(d.participants).toBe(0);
    const md = renderDigestMarkdown(d);
    expect(md).toContain('无消息');
  });

  it('topSpeakers / maxHighlights 可配置', () => {
    const d = buildDigest(messages, { topSpeakers: 1, maxHighlights: 2 });
    expect(d.speakers).toHaveLength(1);
    expect(d.highlights.length).toBeLessThanOrEqual(2);
  });
});

describe('renderDigestMarkdown', () => {
  it('包含 AI 摘要与活跃时段柱状图', () => {
    const d = buildDigest([
      msg('2026-11-04T09:10:00', 1, '张三', 'hello'),
      msg('2026-11-04T09:20:00', 1, '张三', 'world'),
    ]);
    const md = renderDigestMarkdown(d, '- 要点一\n- 要点二');
    expect(md).toContain('## AI 摘要');
    expect(md).toContain('要点一');
    expect(md).toContain('## 活跃时段');
    expect(md).toContain('09时');
  });

  it('没有 AI 摘要时不渲染该段', () => {
    const d = buildDigest([msg('2026-11-04T09:10:00', 1, '张三', 'hi')]);
    expect(renderDigestMarkdown(d)).not.toContain('## AI 摘要');
  });
});

describe('renderDigestText', () => {
  const d = buildDigest([
    msg('2026-11-04T09:10:00', 1, '张三', '明天下午三点开会'),
    msg('2026-11-04T09:20:00', 1, '张三', '材料我发群里了'),
    msg('2026-11-04T14:30:00', 2, '李四', '@全体成员 下午三点开会，别迟到'),
  ], { title: '群 123 日报' });

  it('包含标题、统计、发言榜与活跃时段', () => {
    const t = renderDigestText(d);
    expect(t).toContain('群 123 日报');
    expect(t).toContain('3 条 / 2 人');
    expect(t).toContain('发言最多');
    expect(t).toContain('最活跃时段');
  });

  it('超长时截断并带省略号', () => {
    const t = renderDigestText(d, 40);
    expect(t.length).toBeLessThanOrEqual(40);
    expect(t.endsWith('…')).toBe(true);
  });

  it('空日报不崩', () => {
    expect(renderDigestText(buildDigest([]))).toContain('无消息');
  });
});
