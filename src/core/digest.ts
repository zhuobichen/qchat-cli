/**
 * 群日报（digest）：把一段时间内的群消息压成一份可读的结构化摘要。
 *
 * 纯函数，不碰网络、不碰磁盘，方便单测。
 * AI 摘要由调用方决定是否附加（见 commands/digest.ts）。
 */

export interface DigestMessage {
  /** 秒级时间戳 */
  time: number;
  senderId: number;
  senderName: string;
  text: string;
}

export interface DigestOptions {
  title?: string;
  topSpeakers?: number;
  maxHighlights?: number;
}

export interface DigestSpeaker {
  id: number;
  name: string;
  count: number;
}

export interface DigestHighlight {
  time: number;
  senderName: string;
  text: string;
  reason: 'long' | 'link' | 'mention' | 'file';
}

export interface Digest {
  title: string;
  /** 起始/结束时间（秒） */
  from: number;
  to: number;
  total: number;
  participants: number;
  speakers: DigestSpeaker[];
  hourly: number[];
  highlights: DigestHighlight[];
  links: string[];
  mentions: number;
}

const LINK_RE = /https?:\/\/[^\s，。）)]+/i;
const FILE_RE = /\[(文件|合并转发|视频)\]/;

/** 稳定截断，避免摘要里出现超长单条 */
function clip(text: string, max = 120): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

export function buildDigest(messages: DigestMessage[], options: DigestOptions = {}): Digest {
  const topSpeakers = options.topSpeakers ?? 5;
  const maxHighlights = options.maxHighlights ?? 12;

  const sorted = [...messages].sort((a, b) => a.time - b.time);
  const hourly = new Array(24).fill(0);
  const bySpeaker = new Map<number, DigestSpeaker>();
  const highlights: DigestHighlight[] = [];
  const links = new Set<string>();
  let mentions = 0;

  for (const m of sorted) {
    const d = new Date(m.time * 1000);
    hourly[d.getHours()] += 1;

    const prev = bySpeaker.get(m.senderId);
    if (prev) prev.count += 1;
    else bySpeaker.set(m.senderId, { id: m.senderId, name: m.senderName, count: 1 });

    const text = m.text ?? '';
    if (/@全体成员|@全体/.test(text)) mentions += 1;
    const link = text.match(LINK_RE);
    if (link) links.add(link[0]);

    let reason: DigestHighlight['reason'] | null = null;
    if (link) reason = 'link';
    else if (FILE_RE.test(text)) reason = 'file';
    else if (/@全体成员|@全体|@\d{5,12}/.test(text)) reason = 'mention';
    else if (text.length >= 60) reason = 'long';
    if (reason) highlights.push({ time: m.time, senderName: m.senderName, text: clip(text), reason });
  }

  const speakers = [...bySpeaker.values()].sort((a, b) => b.count - a.count).slice(0, topSpeakers);

  return {
    title: options.title ?? '群日报',
    from: sorted.length ? sorted[0].time : 0,
    to: sorted.length ? sorted[sorted.length - 1].time : 0,
    total: sorted.length,
    participants: bySpeaker.size,
    speakers,
    hourly,
    highlights: highlights.slice(-maxHighlights),
    links: [...links].slice(0, 20),
    mentions,
  };
}

function fmtTime(ts: number, withDate = true): string {
  const d = new Date(ts * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  const hm = `${p(d.getHours())}:${p(d.getMinutes())}`;
  return withDate ? `${p(d.getMonth() + 1)}-${p(d.getDate())} ${hm}` : hm;
}

const REASON_LABEL: Record<DigestHighlight['reason'], string> = {
  long: '长文',
  link: '链接',
  mention: '点名',
  file: '附件',
};

export function renderDigestMarkdown(digest: Digest, aiSummary?: string): string {
  const lines: string[] = [];
  const range = digest.total
    ? `${fmtTime(digest.from)} → ${fmtTime(digest.to)}`
    : '（无消息）';

  lines.push(`# ${digest.title}`);
  lines.push('');
  lines.push(`- 时间范围：${range}`);
  lines.push(`- 消息数：**${digest.total}**　参与人数：**${digest.participants}**　@全体：${digest.mentions}`);
  lines.push('');

  if (aiSummary) {
    lines.push('## AI 摘要');
    lines.push('');
    lines.push(aiSummary.trim());
    lines.push('');
  }

  if (digest.speakers.length) {
    lines.push('## 谁说得最多');
    lines.push('');
    lines.push('| 成员 | 条数 |');
    lines.push('| --- | ---: |');
    for (const s of digest.speakers) lines.push(`| ${s.name} | ${s.count} |`);
    lines.push('');
  }

  const peak = Math.max(...digest.hourly);
  if (peak > 0) {
    lines.push('## 活跃时段');
    lines.push('');
    lines.push('```text');
    for (let h = 0; h < 24; h += 1) {
      if (digest.hourly[h] === 0) continue;
      const bar = '█'.repeat(Math.max(1, Math.round((digest.hourly[h] / peak) * 24)));
      lines.push(`${String(h).padStart(2, '0')}时 ${bar} ${digest.hourly[h]}`);
    }
    lines.push('```');
    lines.push('');
  }

  if (digest.highlights.length) {
    lines.push('## 值得回看');
    lines.push('');
    for (const h of digest.highlights) {
      lines.push(`- \`${fmtTime(h.time, false)}\` **${h.senderName}**（${REASON_LABEL[h.reason]}）：${h.text}`);
    }
    lines.push('');
  }

  if (digest.links.length) {
    lines.push('## 分享的链接');
    lines.push('');
    for (const l of digest.links) lines.push(`- ${l}`);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * 渲染成适合直接发到 QQ 的紧凑纯文本（Markdown 在 QQ 里不渲染）。
 * 超长时截断并注明完整文件。
 */
export function renderDigestText(digest: Digest, maxChars = 1500): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const fmt = (ts: number) => {
    const d = new Date(ts * 1000);
    return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  const lines: string[] = [];
  lines.push(`${digest.title}`);
  lines.push(digest.total
    ? `${fmt(digest.from)} → ${fmt(digest.to)}｜${digest.total} 条 / ${digest.participants} 人`
    : '（无消息）');

  if (digest.speakers.length) {
    lines.push(`发言最多：${digest.speakers.slice(0, 3).map((s) => `${s.name} ${s.count}`).join('、')}`);
  }

  const peak = Math.max(...digest.hourly);
  if (peak > 0) {
    const top = digest.hourly.indexOf(peak);
    lines.push(`最活跃时段：${p(top)} 时（${peak} 条）`);
  }

  if (digest.highlights.length) {
    lines.push('值得回看：');
    for (const h of digest.highlights.slice(0, 5)) {
      lines.push(`· ${fmt(h.time)} ${h.senderName}：${h.text}`);
    }
  }

  let text = lines.join('\n');
  if (text.length > maxChars) text = `${text.slice(0, maxChars - 1)}…`;
  return text;
}
