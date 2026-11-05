/**
 * 向量存储：与消息索引并列，按群存 JSONL（每行 {id, v: base64(float32)}）。
 *
 * 只做存取与相似度排序，不联网，便于单测。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { cosine, decodeVector, encodeVector } from './embeddings.js';

export interface VectorRecord {
  id: string;
  v: string;
}

export interface VectorHit {
  id: string;
  score: number;
}

const FILE_RE = /^vectors-(-?\d+)\.jsonl$/;

export class VectorStore {
  root: string;

  constructor(root: string) {
    try {
      mkdirSync(root, { recursive: true });
      this.root = root;
    } catch {
      const fallback = join(process.cwd(), '.qce-index');
      mkdirSync(fallback, { recursive: true });
      this.root = fallback;
    }
  }

  private fileFor(groupId: number): string {
    return join(this.root, `vectors-${groupId}.jsonl`);
  }

  /** 读原始 base64 映射（写回时用，避免反复编解码） */
  private loadRaw(groupId: number): Map<string, string> {
    const out = new Map<string, string>();
    const file = this.fileFor(groupId);
    if (!existsSync(file)) return out;
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try {
        const rec = JSON.parse(t) as VectorRecord;
        if (rec && typeof rec.id === 'string' && typeof rec.v === 'string') out.set(rec.id, rec.v);
      } catch {
        // 坏行跳过：一行脏数据不该毁掉整个向量库
      }
    }
    return out;
  }

  load(groupId: number): Map<string, Float32Array> {
    const out = new Map<string, Float32Array>();
    for (const [id, v] of this.loadRaw(groupId)) out.set(id, decodeVector(v));
    return out;
  }

  /** 合并写入：同 id 覆盖，其余保留；整体重写保证文件内无重复 */
  upsert(groupId: number, items: { id: string; vec: ArrayLike<number> }[]): { added: number; total: number } {
    const raw = this.loadRaw(groupId);
    let added = 0;
    for (const item of items) {
      if (!item || typeof item.id !== 'string' || !item.vec) continue;
      if (!raw.has(item.id)) added += 1;
      raw.set(item.id, encodeVector(item.vec));
    }
    const body = [...raw.entries()].map(([id, v]) => JSON.stringify({ id, v })).join('\n');
    const file = this.fileFor(groupId);
    try {
      if (existsSync(file)) unlinkSync(file);
    } catch {
      // 删不掉就覆盖写
    }
    appendFileSync(file, body ? `${body}\n` : '', 'utf8');
    return { added, total: raw.size };
  }

  stats(): { groupId: number; count: number }[] {
    if (!existsSync(this.root)) return [];
    const out: { groupId: number; count: number }[] = [];
    for (const name of readdirSync(this.root)) {
      const m = name.match(FILE_RE);
      if (!m) continue;
      const groupId = Number(m[1]);
      const count = this.loadRaw(groupId).size;
      if (count > 0) out.push({ groupId, count });
    }
    return out;
  }

  clear(groupId?: number): void {
    if (groupId !== undefined) {
      try {
        const file = this.fileFor(groupId);
        if (existsSync(file)) unlinkSync(file);
      } catch {
        /* 忽略 */
      }
      return;
    }
    for (const s of this.stats()) {
      try {
        const file = this.fileFor(s.groupId);
        if (existsSync(file)) unlinkSync(file);
      } catch {
        /* 忽略 */
      }
    }
  }

  /** 群内按余弦相似度取 top-k */
  search(groupId: number, query: ArrayLike<number>, limit = 20): VectorHit[] {
    return topK(this.load(groupId), query, limit);
  }
}

/** 纯函数：对 id→vector 映射做 top-k 检索 */
export function topK(
  vectors: Map<string, ArrayLike<number>>,
  query: ArrayLike<number>,
  limit = 20,
): VectorHit[] {
  const hits: VectorHit[] = [];
  for (const [id, vec] of vectors) {
    const score = cosine(query, vec);
    if (score > 0) hits.push({ id, score });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, Math.max(1, limit));
}
