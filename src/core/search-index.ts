/**
 * 本地检索：把消息切成可搜索的 token，做加权打分并给出上下文片段。
 *
 * 纯函数，不碰网络/磁盘，便于单测。
 * 中文按「二元组」切分（不依赖分词词典），拉丁字母/数字按词切分。
 */

export interface SearchDoc {
  /** 稳定 id（message_id 或 time:seq） */
  id: string;
  groupId?: number;
  time: number;
  senderId: number;
  senderName: string;
  text: string;
}

export interface SearchHit extends SearchDoc {
  score: number;
  snippet: string;
}

export interface SearchOptions {
  limit?: number;
  /** 只要某群 */
  groupId?: number;
  /** 起始时间（秒） */
  since?: number;
  /** 结束时间（秒） */
  until?: number;
  /** 只看某个人 */
  senderId?: number;
}

/** 中文二元组 + 拉丁词；统一小写 */
export function tokenize(text: string): string[] {
  const norm = String(text ?? '').toLowerCase();
  const tokens: string[] = [];

  // 拉丁/数字词
  for (const m of norm.matchAll(/[a-z0-9][a-z0-9_+.-]*/g)) {
    if (m[0].length >= 1) tokens.push(m[0]);
  }

  // 连续中日韩字符段，切二元组（单字段保留单字）
  for (const m of norm.matchAll(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+/g)) {
    const seg = m[0];
    if (seg.length === 1) tokens.push(seg);
    else for (let i = 0; i + 1 < seg.length; i += 1) tokens.push(seg.slice(i, i + 2));
  }

  return tokens;
}

/** 查询里的token（去重，保证交集计算稳定） */
function queryTokens(query: string): string[] {
  return [...new Set(tokenize(query))];
}

function countMap(tokens: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of tokens) m.set(t, (m.get(t) ?? 0) + 1);
  return m;
}

/**
 * 片段：命中的第一个 token 前后各取 window 字符。
 * 找不到命中位置就取开头。
 */
export function makeSnippet(text: string, query: string, window = 40): string {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (flat.length <= window * 2) return flat;

  const lower = flat.toLowerCase();
  let pos = -1;
  for (const t of queryTokens(query)) {
    const i = lower.indexOf(t);
    if (i >= 0 && (pos < 0 || i < pos)) pos = i;
  }
  if (pos < 0) return `${flat.slice(0, window * 2)}…`;

  const start = Math.max(0, pos - window);
  const end = Math.min(flat.length, pos + window);
  return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`;
}

/**
 * 打分：命中 token 数与查询 token 数的比值（覆盖率）为主，
 * 词频与时间新鲜度做次要修正；完全不含任何查询 token 的文档直接丢弃。
 */
export function scoreDoc(doc: SearchDoc, tokens: string[]): number {
  if (tokens.length === 0) return 0;
  const docTokens = countMap(tokenize(doc.text));
  let hit = 0;
  let freq = 0;
  for (const t of tokens) {
    const c = docTokens.get(t);
    if (c) {
      hit += 1;
      freq += c;
    }
  }
  if (hit === 0) return 0;

  const coverage = hit / tokens.length;
  const freqBoost = Math.min(0.3, Math.log1p(freq) / 10);
  // 时间新鲜度：越新略微加分（最多 0.1），只用于同分排序接近时
  const ageDays = Math.max(0, (Date.now() / 1000 - doc.time) / 86400);
  const recency = Math.max(0, 0.1 - ageDays / 3650);

  return coverage * 2 + freqBoost + recency;
}

export function searchDocs(docs: SearchDoc[], query: string, options: SearchOptions = {}): SearchHit[] {
  const tokens = queryTokens(query);
  if (tokens.length === 0) return [];

  const limit = Math.max(1, options.limit ?? 20);
  const hits: SearchHit[] = [];

  for (const doc of docs) {
    if (options.groupId !== undefined && doc.groupId !== options.groupId) continue;
    if (options.senderId !== undefined && doc.senderId !== options.senderId) continue;
    if (options.since !== undefined && doc.time < options.since) continue;
    if (options.until !== undefined && doc.time > options.until) continue;

    const score = scoreDoc(doc, tokens);
    if (score <= 0) continue;
    hits.push({ ...doc, score, snippet: makeSnippet(doc.text, query) });
  }

  hits.sort((a, b) => (b.score - a.score) || (b.time - a.time));
  return hits.slice(0, limit);
}

/** 把命中结果渲染成终端可读文本 */
export function renderHits(hits: SearchHit[]): string {
  if (hits.length === 0) return '没有命中。';
  const pad = (n: number) => String(n).padStart(2, '0');
  return hits
    .map((h) => {
      const d = new Date(h.time * 1000);
      const when = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
      const where = h.groupId ? `群${h.groupId}` : '私聊';
      return `[${when}] ${where} ${h.senderName} (${h.score.toFixed(2)})\n    ${h.snippet}`;
    })
    .join('\n');
}
