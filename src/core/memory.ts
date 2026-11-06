/**
 * 会淡忘的长期记忆。
 *
 * 借鉴 dsh-fish-memory 的思路（不是抄代码）：每条记忆带时间戳与基础权重，
 * 检索时按「半衰期」衰减，过期的直接淘汰；每轮只把最重的几条注入上下文。
 *
 * 与现有 group-context 的区别：那边的"压缩"是不可逆失忆，
 * 这里是"逐渐变淡"——原话还在，只是权重下降。
 *
 * 纯函数（衰减、排序、淘汰）+ 薄存储层（JSONL），便于单测。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

export interface MemoryRecord {
  /** 稳定 id（内容 hash） */
  id: string;
  /** 谁的事：群号或 QQ 号 */
  scope: string;
  /** 记忆正文 */
  text: string;
  /** 创建时间（秒） */
  createdAt: number;
  /** 基础权重 0-1，越重要越高 */
  weight: number;
  /** 最后一次被召回的时间（秒），用于"越常想起越难忘" */
  lastUsedAt?: number;
  /** 自定义过期时间（秒）；不填则用默认 TTL */
  expiresAt?: number;
  /** 标签，便于按主题召回 */
  tags?: string[];
}

export interface DecayOptions {
  /** 半衰期（秒），默认 30 天 */
  halfLifeSec?: number;
  /** 默认 TTL（秒），默认 180 天 */
  defaultTtlSec?: number;
  /** 检索时的时间基准，默认当前时间 */
  now?: number;
}

const DEFAULT_HALF_LIFE = 30 * 86400;
const DEFAULT_TTL = 180 * 86400;

/**
 * 当前权重：基础权重 × 半衰期衰减。
 * 被召回过的记忆从 lastUsedAt 重新计时（复习效应）。
 */
export function decayedWeight(record: MemoryRecord, options: DecayOptions = {}): number {
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const halfLife = Math.max(1, options.halfLifeSec ?? DEFAULT_HALF_LIFE);
  const anchor = Math.max(record.lastUsedAt ?? 0, record.createdAt);
  const age = Math.max(0, now - anchor);
  return record.weight * Math.pow(0.5, age / halfLife);
}

/** 是否已过期：显式 expiresAt 优先，否则按 defaultTtl 相对 createdAt */
export function isExpired(record: MemoryRecord, options: DecayOptions = {}): boolean {
  const now = options.now ?? Math.floor(Date.now() / 1000);
  if (typeof record.expiresAt === 'number') return now >= record.expiresAt;
  const ttl = options.defaultTtlSec ?? DEFAULT_TTL;
  return now - record.createdAt >= ttl;
}

/**
 * 召回：先淘汰过期项，再按衰减权重排序，只返回权重高于阈值的 top-K。
 */
export function recallMemories(
  records: MemoryRecord[],
  options: DecayOptions & { scope?: string; limit?: number; minWeight?: number; now?: number } = {},
): Array<MemoryRecord & { score: number }> {
  const limit = Math.max(1, options.limit ?? 5);
  const minWeight = options.minWeight ?? 0.05;

  return records
    .filter((r) => (options.scope === undefined ? true : r.scope === options.scope))
    .filter((r) => !isExpired(r, options))
    .map((r) => ({ ...r, score: decayedWeight(r, options) }))
    .filter((r) => r.score >= minWeight)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** 按关键词过滤（简单子串，大小写不敏感），可与 recall 组合 */
export function filterByKeyword(records: MemoryRecord[], keyword: string): MemoryRecord[] {
  if (!keyword) return records;
  const k = keyword.toLowerCase();
  return records.filter((r) => r.text.toLowerCase().includes(k) || (r.tags ?? []).some((t) => t.toLowerCase().includes(k)));
}

/** 内容 hash 作为 id（同内容不重复存） */
export function memoryId(scope: string, text: string): string {
  // 用轻量 hash，避免引入 crypto 依赖带来的同步开销
  let h1 = 0x811c9dc5;
  const src = `${scope}\u0000${text}`;
  for (let i = 0; i < src.length; i += 1) {
    h1 ^= src.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193) >>> 0;
  }
  return h1.toString(16).padStart(8, '0');
}

/** 把记忆渲染成注入上下文的一段文本 */
export function renderMemories(records: Array<MemoryRecord & { score: number }>): string {
  if (records.length === 0) return '';
  const lines = records.map((r) => {
    const ageDays = Math.max(0, Math.floor((Date.now() / 1000 - r.createdAt) / 86400));
    const freshness = ageDays === 0 ? '今天' : `${ageDays} 天前`;
    return `- （${freshness}，权重 ${r.score.toFixed(2)}）${r.text}`;
  });
  return ['【长期记忆·按时间淡忘】', ...lines].join('\n');
}

/** JSONL 存储：追加写、读取去重 */
export class MemoryStore {
  file: string;

  constructor(root: string) {
    try {
      mkdirSync(root, { recursive: true });
      this.file = join(root, 'memories.jsonl');
    } catch {
      const fallback = join(process.cwd(), '.qce-index');
      mkdirSync(fallback, { recursive: true });
      this.file = join(fallback, 'memories.jsonl');
    }
  }

  load(): MemoryRecord[] {
    if (!existsSync(this.file)) return [];
    const byId = new Map<string, MemoryRecord>();
    for (const line of readFileSync(this.file, 'utf8').split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try {
        const r = JSON.parse(t) as MemoryRecord;
        if (r && typeof r.id === 'string') byId.set(r.id, r);
      } catch {
        // 坏行跳过
      }
    }
    return [...byId.values()];
  }

  /** 新增（同 id 幂等）；返回是否真的写入 */
  remember(input: Omit<MemoryRecord, 'id'> & { id?: string }): { record: MemoryRecord; added: boolean } {
    const id = input.id ?? memoryId(input.scope, input.text);
    const existing = this.load().find((r) => r.id === id);
    if (existing) return { record: existing, added: false };
    const record: MemoryRecord = { ...input, id };
    appendFileSync(this.file, `${JSON.stringify(record)}\n`, 'utf8');
    return { record, added: true };
  }

  /** 标记被召回（复习：重新计时） */
  touch(id: string, now = Math.floor(Date.now() / 1000)): void {
    const records = this.load();
    const hit = records.find((r) => r.id === id);
    if (!hit) return;
    hit.lastUsedAt = now;
    this.save(records);
  }

  /** 物理删除（清理过期项） */
  prune(options: DecayOptions = {}): number {
    const records = this.load();
    const kept = records.filter((r) => !isExpired(r, options));
    if (kept.length !== records.length) this.save(kept);
    return records.length - kept.length;
  }

  save(records: MemoryRecord[]): void {
    writeFileSync(this.file, records.map((r) => JSON.stringify(r)).join('\n') + (records.length ? '\n' : ''), 'utf8');
  }
}
