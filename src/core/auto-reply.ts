/**
 * 自动回复循环：收消息 → 判断该不该回 → 生成回复 → 选文字/语音 → 发送。
 *
 * 这是「常驻进程」版本，把原本要人手动触发的一整条链路自动化。
 * 每一步都有界：超时、重试、熔断、DLQ；失败的消息不丢。
 *
 * 设计要点：
 *   - 幂等：靠 message id 去重，重复跑不会重复回
 *   - 断点续传：状态原子写入，关机再开机从上次位置继续
 *   - 保守：拿不准就不回（宁可漏回也不乱回）
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { withResilience, CircuitBreaker, DeadLetterQueue } from './reliability.js';

export interface AutoConfig {
  /** OneBot 地址 */
  http: string;
  token: string;
  /** 处理哪些会话：空 = 全部私聊；群需要显式列出 */
  groups: number[];
  includePrivate: boolean;
  /** 允许回复的会话白名单（QQ 号/群号）；空 = 不限制 */
  allow: string[];
  /** 轮询间隔（秒） */
  intervalSec: number;
  /** 单条消息最长等待回复的年龄（秒），太老不回 */
  maxAgeSec: number;
  /** 私聊回复的最小间隔（秒），避免刷屏 */
  minReplyGapSec: number;
  /** 群里必须 @ 才回 */
  requireMentionInGroup: boolean;
  /** 语音开关 */
  allowVoice: boolean;
  /** 本地 TTS 服务 */
  ttsEndpoint: string;
  ttsRefAudio: string;
  ttsPromptText: string;
  /** 输出目录 */
  outputDir: string;
  /** 状态目录 */
  stateDir: string;
}

export const DEFAULT_AUTO_CONFIG: AutoConfig = {
  http: 'http://127.0.0.1:3000',
  token: '',
  groups: [],
  includePrivate: true,
  allow: [],
  intervalSec: 15,
  maxAgeSec: 600,
  minReplyGapSec: 20,
  requireMentionInGroup: true,
  allowVoice: true,
  ttsEndpoint: '',
  ttsRefAudio: '',
  ttsPromptText: '',
  outputDir: './output',
  stateDir: '',
};

export function loadAutoConfig(path: string): AutoConfig {
  let raw: any = {};
  try { raw = JSON.parse(readFileSync(path, 'utf8')); } catch {}
  const cfg: AutoConfig = { ...DEFAULT_AUTO_CONFIG };
  if (raw.http) cfg.http = raw.http;
  if (raw.token) cfg.token = raw.token;
  if (Array.isArray(raw.groups)) cfg.groups = raw.groups.map(Number);
  if (typeof raw.includePrivate === 'boolean') cfg.includePrivate = raw.includePrivate;
  if (Array.isArray(raw.allow)) cfg.allow = raw.allow.map(String);
  if (raw.intervalSec) cfg.intervalSec = Math.max(Number(raw.intervalSec), 5);
  if (raw.maxAgeSec) cfg.maxAgeSec = Math.max(Number(raw.maxAgeSec), 30);
  if (raw.minReplyGapSec) cfg.minReplyGapSec = Math.max(Number(raw.minReplyGapSec), 0);
  if (typeof raw.requireMentionInGroup === 'boolean') cfg.requireMentionInGroup = raw.requireMentionInGroup;
  if (typeof raw.allowVoice === 'boolean') cfg.allowVoice = raw.allowVoice;
  if (raw.ttsEndpoint) cfg.ttsEndpoint = raw.ttsEndpoint;
  if (raw.ttsRefAudio) cfg.ttsRefAudio = raw.ttsRefAudio;
  if (raw.ttsPromptText) cfg.ttsPromptText = raw.ttsPromptText;
  if (raw.outputDir) cfg.outputDir = raw.outputDir;
  if (raw.stateDir) cfg.stateDir = raw.stateDir;
  return cfg;
}

export interface AutoState {
  version: 1;
  /** 已处理的消息 id */
  handled: Record<string, 1>;
  /** 每个会话上次回复时间（秒） */
  lastReplyAt: Record<string, number>;
  /** 每个会话的水位（秒） */
  cursors: Record<string, number>;
  /** 统计 */
  stats: { polls: number; replied: number; skipped: number; failed: number };
}

export function emptyAutoState(): AutoState {
  return { version: 1, handled: {}, lastReplyAt: {}, cursors: {}, stats: { polls: 0, replied: 0, skipped: 0, failed: 0 } };
}

export function loadAutoState(path: string): AutoState {
  if (!existsSync(path)) return emptyAutoState();
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return {
      ...emptyAutoState(),
      ...parsed,
      handled: parsed.handled ?? {},
      lastReplyAt: parsed.lastReplyAt ?? {},
      cursors: parsed.cursors ?? {},
      stats: parsed.stats ?? { polls: 0, replied: 0, skipped: 0, failed: 0 },
    };
  } catch {
    try { renameSync(path, `${path}.corrupt-${Date.now()}`); } catch {}
    return emptyAutoState();
  }
}

/** 原子写状态（断电不会写坏） */
export function saveAutoState(path: string, state: AutoState): void {
  try {
    mkdirSync(join(path, '..'), { recursive: true });
    const ids = Object.keys(state.handled);
    if (ids.length > 3000) for (const id of ids.slice(0, ids.length - 3000)) delete state.handled[id];
    const tmp = `${path}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify(state), 'utf8');
    renameSync(tmp, path);
  } catch {}
}

/** 判断这条消息该不该自动回复 */
export interface ReplyDecision {
  reply: boolean;
  reason: string;
}

export function shouldReply(
  message: { kind: 'private' | 'group'; peer: string; mentioned: boolean; time: number; senderId: number },
  state: AutoState,
  config: AutoConfig,
  now = Math.floor(Date.now() / 1000),
): ReplyDecision {
  const key = `${message.kind === 'group' ? 'g' : 'p'}${message.peer}`;

  if (config.allow.length > 0 && !config.allow.includes(message.peer)) {
    return { reply: false, reason: '不在白名单' };
  }
  if (message.kind === 'group' && !config.groups.includes(Number(message.peer))) {
    return { reply: false, reason: '该群不在自动回复列表' };
  }
  if (message.kind === 'private' && !config.includePrivate) {
    return { reply: false, reason: '私聊自动回复已关闭' };
  }
  if (message.kind === 'group' && config.requireMentionInGroup && !message.mentioned) {
    return { reply: false, reason: '群里没 @ 我' };
  }
  if (now - message.time > config.maxAgeSec) {
    return { reply: false, reason: `消息太老（${now - message.time}s）` };
  }
  const last = state.lastReplyAt[key] ?? 0;
  if (last && now - last < config.minReplyGapSec) {
    return { reply: false, reason: `距上次回复不足 ${config.minReplyGapSec}s` };
  }
  return { reply: true, reason: '通过' };
}

/** 记录已回复 */
export function markReplied(state: AutoState, key: string, now: number): void {
  state.lastReplyAt[key] = now;
}

/** 组装 OneBot 调用 */
export async function onebot(
  config: AutoConfig,
  action: string,
  params: Record<string, unknown> = {},
  timeoutMs = 20000,
): Promise<any> {
  const res = await fetch(`${config.http}/${action}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
    },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const json: any = await res.json();
  if (json.status !== 'ok' && json.retcode !== 0) {
    throw new Error(`${action}: ${json.message ?? json.wording ?? 'failed'}`);
  }
  return json.data;
}

/** 消息段拍平成文本 */
export function flattenSegments(message: unknown): string {
  if (typeof message === 'string') return message;
  if (!Array.isArray(message)) return '';
  return message
    .map((s: any) => {
      switch (s?.type) {
        case 'text': return s.data?.text ?? '';
        case 'image': return '[图片]';
        case 'face': case 'mface': return '[表情]';
        case 'record': return '[语音]';
        case 'video': return '[视频]';
        case 'file': return '[文件]';
        case 'at': return `@${s.data?.qq === 'all' ? '全体' : s.data?.qq}`;
        case 'reply': return '';
        default: return `[${s?.type ?? '?'}]`;
      }
    })
    .join('')
    .trim();
}

/** 消息里有没有语音段 */
export function hasVoiceSegment(message: unknown): boolean {
  if (!Array.isArray(message)) return false;
  return message.some((s: any) => s?.type === 'record');
}

/** 是否 @ 了我 */
export function mentionsSelf(message: unknown, selfUin: number): boolean {
  if (!Array.isArray(message)) return false;
  return message.some((s: any) => s?.type === 'at' && String(s.data?.qq) === String(selfUin));
}

/** 死信队列（自动回复专用目录） */
export function makeDlq(stateDir: string): DeadLetterQueue {
  mkdirSync(stateDir, { recursive: true });
  return new DeadLetterQueue(stateDir);
}

export { withResilience, CircuitBreaker, DeadLetterQueue };
