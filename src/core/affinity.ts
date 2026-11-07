import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * 好感度 + 用户画像。
 *
 * 为什么需要：现在我知道「谁是谁」，但不知道「跟谁熟」。
 * 对每个人都用同一档语气，结果要么对生人太损，要么对熟人太客气——
 * 两种都不像真人。真人是有关系梯度的。
 *
 * 记录的事（都能从消息流里观察到，不需要猜）：
 *   - 他跟我说过几次话
 *   - 我回过他几次
 *   - 他接我话几次（正反馈，比说话更能说明关系）
 *   - 他怼我几次（不是坏事，说明在玩）
 *   - 多久没说话了（时间会淡）
 *
 * 不记录的事：不记录聊天内容原文。只留计数和话题关键词。
 */

export type RelationTag = 'stranger' | 'newcomer' | 'regular' | 'friend';

export interface AffinityRecord {
  uin: string;
  /** 最近一次见到的显示名 */
  name: string;
  firstMetAt: number;
  lastTalkAt: number;
  /** 他发给我/我接的话次数 */
  msgsFrom: number;
  /** 我回他的次数 */
  msgsTo: number;
  /** 他在我发言之后接着说的次数（正反馈） */
  engaged: number;
  /** 他怼我/骂我的次数（不是负分，是"在玩"的信号） */
  snubs: number;
  /** 我该怎么称呼他（人工/自动） */
  nick?: string;
  /** 话题关键词 → 出现次数 */
  topics?: Record<string, number>;
  /** 人工标记的关系，会覆盖自动算出来的 */
  tag?: RelationTag;
}

export interface AffinityFile {
  version: 1;
  users: Record<string, AffinityRecord>;
}

export const DEFAULT_AFFINITY_PATH = 'private/affinity.json';

/** 好感度半衰期：45 天不联系就淡一半。比梗的半衰期长——关系比梗结实。 */
export const AFFINITY_HALF_LIFE_MS = 45 * 24 * 3600_000;

const EMPTY: AffinityFile = { version: 1, users: {} };

export function loadAffinity(path = DEFAULT_AFFINITY_PATH): AffinityFile {
  try {
    if (!existsSync(path)) return { ...EMPTY, users: {} };
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    if (!raw || typeof raw !== 'object') return { ...EMPTY, users: {} };
    return { version: 1, users: raw.users ?? {} };
  } catch {
    return { ...EMPTY, users: {} };
  }
}

export function saveAffinity(file: AffinityFile, path = DEFAULT_AFFINITY_PATH): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(file, null, 2), 'utf8');
  } catch {
    /* 记不下来不影响回复 */
  }
}

/**
 * 打分基线：原始互动量 → 一个没衰减的分。
 *
 * 权重为什么这么给：
 *   engaged（他接我话）×3 —— 最强的"愿意聊"信号
 *   msgsFrom          ×1 —— 他主动找我
 *   msgsTo            ×0.5 —— 我单方面回不算关系
 *   snubs             ×0.5 —— 怼也是互动，但算半个
 */
export function rawScore(r: AffinityRecord): number {
  return r.msgsFrom * 1 + r.engaged * 3 + r.msgsTo * 0.5 + r.snubs * 0.5;
}

/** 时间衰减后的分数 */
export function scoreOf(r: AffinityRecord, now = Date.now()): number {
  const raw = rawScore(r);
  if (raw <= 0) return 0;
  const idle = Math.max(0, now - (r.lastTalkAt || r.firstMetAt || now));
  return raw * Math.pow(0.5, idle / AFFINITY_HALF_LIFE_MS);
}

/**
 * 关系档位。人工 tag 优先，否则按分数算。
 *
 * 阈值是拍的，但方向对：3 分以下基本是陌生人（打过一两次照面）。
 */
export function tagOf(r: AffinityRecord, now = Date.now()): RelationTag {
  if (r.tag) return r.tag;
  const s = scoreOf(r, now);
  if (s >= 30) return 'friend';
  if (s >= 10) return 'regular';
  if (s >= 3) return 'newcomer';
  return 'stranger';
}

const TAG_CN: Record<RelationTag, string> = {
  stranger: '生面孔',
  newcomer: '眼熟',
  regular: '熟人',
  friend: '老哥',
};

export function tagLabel(t: RelationTag): string {
  return TAG_CN[t];
}

/**
 * 关系决定了"该怎么说话"。
 *
 * 这是整个模块的重点——不是给个分数，是给出**语气指令**。
 */
export function renderRelationForPrompt(r: AffinityRecord | null, now = Date.now()): string {
  if (!r) {
    return '这个人我没印象，当生面孔：客气一点，别上来就损，先接话看看。';
  }
  const tag = tagOf(r, now);
  const name = r.nick || r.name;
  const idleDays = Math.floor((now - (r.lastTalkAt || now)) / 86400_000);

  switch (tag) {
    case 'friend':
      return [
        `「${name}」是老哥（聊过 ${r.msgsFrom + r.msgsTo} 轮，接过我 ${
          r.engaged
        } 次话）。可以损、可以主动找茬、可以问近况，不用客套。`,
        idleDays > 14 ? `不过有 ${idleDays} 天没出现了，别装熟，正常接就行。` : '',
      ]
        .filter(Boolean)
        .join('');
    case 'regular':
      return `「${name}」是熟人。正常聊，可以开点玩笑，但别太上头。`;
    case 'newcomer':
      return `「${name}」打过几次照面。接话为主，别主动损人。`;
    default:
      return `「${name}」基本是生面孔。客气点，别玩梗过头，先看他想说什么。`;
  }
}

/** 一次互动的类型 */
export type InteractionKind = 'from' | 'to' | 'engaged' | 'snub';

export interface AffinityUpdateResult {
  record: AffinityRecord;
  before: RelationTag;
  after: RelationTag;
  /** 关系档位变了（用来决定要不要说点不一样的） */
  changed: boolean;
}

/**
 * 记一次互动，必要时落盘。
 *
 * 只改内存里的对象，落盘由调用方控制（一条消息里可能记多次，
 * 攒着最后写一次，避免频繁 IO）。
 */
export function applyInteraction(
  file: AffinityFile,
  uin: string | number,
  kind: InteractionKind,
  options: { name?: string; now?: number } = {},
): AffinityUpdateResult {
  const key = String(uin);
  const now = options.now ?? Date.now();
  const existing = file.users[key];
  const before = existing ? tagOf(existing, now) : 'stranger';

  const record: AffinityRecord = existing ?? {
    uin: key,
    name: options.name ?? key,
    firstMetAt: now,
    lastTalkAt: now,
    msgsFrom: 0,
    msgsTo: 0,
    engaged: 0,
    snubs: 0,
  };

  if (options.name) record.name = options.name;
  record.lastTalkAt = now;

  switch (kind) {
    case 'from':
      record.msgsFrom += 1;
      break;
    case 'to':
      record.msgsTo += 1;
      break;
    case 'engaged':
      record.engaged += 1;
      break;
    case 'snub':
      record.snubs += 1;
      break;
  }

  file.users[key] = record;
  const after = tagOf(record, now);
  return { record, before, after, changed: before !== after };
}

/**
 * 从一句话里抽话题关键词（粗粒度，够用就行）。
 *
 * 只是为了让画像里有个"他常聊什么"，不做语义理解。
 * 用 2~4 字的中文片段 + 常见主题词表兜底。
 */
const TOPIC_HINTS = [
  '原神', '崩铁', '明日方舟', '鸣潮', '绝区零', '游戏', '抽卡', '氪金',
  '动漫', '新番', '漫画', '轻小说', 'galgame',
  '编程', '代码', 'bug', '服务器', '显卡', '配电脑', '跑分',
  '考试', '考研', '大学', '高中', '工作', '实习', '工资',
  '吃', '外卖', '奶茶', '咖啡', '喝酒', '夜宵',
  '猫', '狗', '宠物',
  '音乐', '唱歌', '吉他', '乐队',
  '健身', '跑步', '篮球',
  '股票', '基金', '币',
];

export function extractTopics(text: string, limit = 3): string[] {
  const hits = TOPIC_HINTS.filter((t) => text.includes(t));
  return hits.slice(0, limit);
}

export function recordTopics(record: AffinityRecord, topics: string[]): void {
  if (topics.length === 0) return;
  record.topics = record.topics ?? {};
  for (const t of topics) record.topics[t] = (record.topics[t] ?? 0) + 1;
}

/** 他最常聊的话题（最多 3 个） */
export function topTopics(r: AffinityRecord, limit = 3): string[] {
  return Object.entries(r.topics ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([t]) => t);
}

/** 把画像渲染成 prompt 里的一段（关系 + 话题 + 称呼） */
export function renderProfileForPrompt(r: AffinityRecord | null, now = Date.now()): string {
  const lines: string[] = [renderRelationForPrompt(r, now)];
  if (r) {
    const topics = topTopics(r);
    if (topics.length) lines.push(`他常聊：${topics.join('、')}。要接得上，别装懂。`);
    if (r.nick) lines.push(`称呼他「${r.nick}」。`);
  }
  return lines.filter(Boolean).join('\n');
}

/** 按分数排个榜，看看谁最熟（给运维面板/自检用） */
export function rankByAffinity(file: AffinityFile, now = Date.now()): Array<{ r: AffinityRecord; score: number; tag: RelationTag }> {
  return Object.values(file.users)
    .map((r) => ({ r, score: scoreOf(r, now), tag: tagOf(r, now) }))
    .sort((a, b) => b.score - a.score);
}
