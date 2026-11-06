/**
 * 读「导出的群历史」文件（qce export --format txt 的产物）。
 *
 * 为什么需要：NapCat 只缓存最近几十条，真正的历史在导出文件（或 QQ 的 nt_msg.db）里。
 * 这个解析器让「读全部历史」变成一次本地文件查询，不依赖账号在线。
 *
 * 文件格式：
 *   群 <id> 共 N 条
 *   时间范围: ...
 *
 *   YYYY-MM-DD HH:MM:SS  昵称(QQ号)
 *       正文（可能多行）
 */

export interface HistoryRecord {
  time: number;
  nick: string;
  qq: number;
  text: string;
}

export interface ParseResult {
  groupId?: number;
  total?: number;
  records: HistoryRecord[];
}

const HEAD_RE = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\s{1,4}(.+?)\((\d{5,12})\)\s*$/;

/** 解析整个导出文件 */
export function parseHistoryFile(content: string): ParseResult {
  const lines = String(content ?? '').split(/\r?\n/);
  const records: HistoryRecord[] = [];
  const out: ParseResult = { records };

  let cur: HistoryRecord | null = null;
  const bodyLines: string[] = [];

  const flush = () => {
    if (cur) {
      cur.text = bodyLines.join('\n').trim();
      records.push(cur);
    }
    bodyLines.length = 0;
  };

  for (const line of lines) {
    const head = HEAD_RE.exec(line);
    if (head) {
      flush();
      cur = {
        time: Math.floor(new Date(head[1].replace(' ', 'T')).getTime() / 1000),
        nick: head[2].trim(),
        qq: Number(head[3]),
        text: '',
      };
      continue;
    }
    if (cur) {
      bodyLines.push(line.replace(/^\s{2,4}/, ''));
      continue;
    }
    // 头部信息
    const g = /群\s+(\d{5,12})\s+共\s+(\d+)\s+条/.exec(line);
    if (g) {
      out.groupId = Number(g[1]);
      out.total = Number(g[2]);
    }
  }
  flush();
  return out;
}

export interface HistoryQuery {
  search?: string;
  from?: number;
  since?: number;
  until?: number;
  limit?: number;
  /** 只要最后 N 条（与 limit 二选一，优先 last） */
  last?: number;
}

/** 过滤 + 截断；顺序保持时间正序 */
export function queryHistory(records: HistoryRecord[], q: HistoryQuery = {}): HistoryRecord[] {
  const keyword = q.search?.toLowerCase();
  let out = records.filter((r) => {
    if (q.from !== undefined && r.qq !== q.from) return false;
    if (q.since !== undefined && r.time < q.since) return false;
    if (q.until !== undefined && r.time > q.until) return false;
    if (keyword && !r.text.toLowerCase().includes(keyword)) return false;
    return true;
  });
  if (q.last !== undefined && q.last > 0) out = out.slice(-q.last);
  else if (q.limit !== undefined && q.limit > 0) out = out.slice(0, q.limit);
  return out;
}

/** 渲染成终端可读文本 */
export function renderHistory(records: HistoryRecord[]): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return records
    .map((r) => {
      const d = new Date(r.time * 1000);
      const when = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
      const body = r.text.split('\n').map((l) => `    ${l}`).join('\n');
      return `${when}  ${r.nick}(${r.qq})\n${body}`;
    })
    .join('\n');
}
