/**
 * 群成员画像：从历史聊天里提炼"谁是谁、爱说什么"。
 *
 * 这不是 AI 总结，是可解释的统计：
 *   - 发言量、活跃时段、常用词、常用梗
 *   - 谁跟谁互动最多
 * 画像存进长期记忆后，朝闻在群里说话才有"这几个人平时什么德行"的底子。
 */
import { parseHistoryFile, type HistoryRecord } from './historyfile.js';

export interface MemberProfile {
  qq: number;
  nick: string;
  messages: number;
  /** 活跃时段：0-23 */
  activeHours: number[];
  topHours: number[];
  /** 高频词（去停用词） */
  topWords: string[];
  /** 高频短语/梗 */
  catchphrases: string[];
  /** 互动最多的对象 */
  topPartners: Array<{ qq: number; nick: string; count: number }>;
  firstSeen: number;
  lastSeen: number;
}

/** 中文停用词 + 群聊口水词 */
const STOPWORDS = new Set([
  '的', '了', '是', '在', '我', '你', '他', '她', '它', '们', '这', '那', '就', '都', '也',
  '啊', '吧', '呢', '吗', '哦', '噢', '嗯', '哈', '呵', '嘿', '喂', '个', '不', '没', '有',
  '一', '上', '下', '中', '大', '小', '多', '少', '好', '来', '去', '说', '看', '会', '能',
  '什么', '怎么', '这样', '那样', '因为', '所以', '但是', '而且', '还是', '已经', '可以',
  'the', 'a', 'an', 'is', 'to', 'of', 'and', 'in', 'it',
]);

/** 提取候选词：中文按 2-4 字滑窗，英文按单词 */
export function extractWords(text: string): string[] {
  const out: string[] = [];
  const cleaned = text.replace(/\[[^\]]{1,12}\]/g, ' ');   // 去掉 [图片] [表情] 这类
  const cn = cleaned.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
  for (const seg of cn) {
    for (let n = 2; n <= 4; n += 1) {
      for (let i = 0; i + n <= seg.length; i += 1) {
        const w = seg.slice(i, i + n);
        if (!STOPWORDS.has(w)) out.push(w);
      }
    }
  }
  const en = cleaned.toLowerCase().match(/[a-z][a-z0-9]{1,14}/g) ?? [];
  for (const w of en) if (!STOPWORDS.has(w)) out.push(w);
  return out;
}

/** 高频短语（整句重复出现的短句） */
export function extractCatchphrases(texts: string[], minLen = 2, minCount = 3): string[] {
  const counter = new Map<string, number>();
  for (const t of texts) {
    const norm = t.trim();
    if (norm.length < minLen || norm.length > 20) continue;
    if (/^\[.+\]$/.test(norm)) continue;      // [图片] [卡片] [空] 不是梗
    if (/^\[[^\]]*\]$/.test(norm)) continue;
    counter.set(norm, (counter.get(norm) ?? 0) + 1);
  }
  return [...counter.entries()]
    .filter(([, c]) => c >= minCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([w]) => w);
}

export interface ProfileOptions {
  /** 只统计这些成员 */
  members?: number[];
  /** 互动窗口（秒） */
  windowSec?: number;
  topWords?: number;
  topCatchphrases?: number;
}

/** 从历史记录生成画像 */
export function buildProfiles(records: HistoryRecord[], options: ProfileOptions = {}): MemberProfile[] {
  const windowSec = options.windowSec ?? 300;
  const topN = options.topWords ?? 12;

  const byMember = new Map<number, { nick: string; msgs: HistoryRecord[] }>();
  for (const r of records) {
    if (options.members && !options.members.includes(r.qq)) continue;
    const cur = byMember.get(r.qq) ?? { nick: r.nick, msgs: [] };
    cur.nick = r.nick;                       // 用最后一次出现的昵称
    cur.msgs.push(r);
    byMember.set(r.qq, cur);
  }

  // 互动：在 A 发言后 windowSec 内 B 发言 → B 是 A 的互动对象
  const partners = new Map<number, Map<number, number>>();
  const sorted = [...records].sort((a, b) => a.time - b.time);
  for (let i = 0; i < sorted.length; i += 1) {
    const a = sorted[i];
    if (options.members && !options.members.includes(a.qq)) continue;
    for (let j = i + 1; j < sorted.length; j += 1) {
      const b = sorted[j];
      if (b.time - a.time > windowSec) break;
      if (b.qq === a.qq) continue;
      if (!partners.has(a.qq)) partners.set(a.qq, new Map());
      const inner = partners.get(a.qq)!;
      inner.set(b.qq, (inner.get(b.qq) ?? 0) + 1);
    }
  }

  const nickOf = (target: number): string => byMember.get(target)?.nick ?? String(target);

  return [...byMember.entries()]
    .map(([qq, { nick, msgs }]) => {
      const hours = new Array(24).fill(0);
      const wordCounter = new Map<string, number>();
      for (const m of msgs) {
        hours[new Date(m.time * 1000).getHours()] += 1;
        for (const w of extractWords(m.text)) wordCounter.set(w, (wordCounter.get(w) ?? 0) + 1);
      }
      const topHours = hours
        .map((count, h) => ({ h, count }))
        .filter((x) => x.count > 0)
        .sort((a, b) => b.count - a.count)
        .slice(0, 3)
        .map((x) => x.h);

      const topWords = [...wordCounter.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, topN)
        .map(([w]) => w);

      const catchphrases = extractCatchphrases(msgs.map((m) => m.text)).slice(0, options.topCatchphrases ?? 5);

      const p = partners.get(qq);
      const topPartners = p
        ? [...p.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([other, count]) => ({ qq: other, nick: nickOf(other), count }))
        : [];

      return {
        qq,
        nick,
        messages: msgs.length,
        activeHours: hours.map((c, h) => (c > 0 ? h : -1)).filter((h) => h >= 0),
        topHours,
        topWords,
        catchphrases,
        topPartners,
        firstSeen: Math.min(...msgs.map((m) => m.time)),
        lastSeen: Math.max(...msgs.map((m) => m.time)),
      };
    })
    .sort((a, b) => b.messages - a.messages);
}

/** 渲染成一段可直接注入上下文的文字 */
export function renderProfiles(profiles: MemberProfile[]): string {
  if (profiles.length === 0) return '';
  const lines = profiles.slice(0, 8).map((p) => {
    const hours = p.topHours.map((h) => `${h}时`).join('/');
    const partners = p.topPartners.map((x) => `${x.nick}`).join('、');
    const bits = [`${p.nick}(${p.qq}) 发言${p.messages}条`];
    if (hours) bits.push(`常在${hours}`);
    if (p.topWords.length) bits.push(`爱说：${p.topWords.slice(0, 6).join('、')}`);
    if (p.catchphrases.length) bits.push(`口头禅：${p.catchphrases.slice(0, 3).join('、')}`);
    if (partners) bits.push(`常和：${partners}`);
    return `- ${bits.join('；')}`;
  });
  return ['【群成员画像（由历史聊天统计得出，不是猜的）】', ...lines].join('\n');
}
