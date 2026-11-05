/**
 * 群文件：纯函数（格式化、过滤、统计）+ 下载编排。
 *
 * 群文件是 QQ 的强功能（课件/作业/工具包），但接口只给 fid，
 * 下载要先换 url 再抓；这些逻辑收在这里，命令层保持薄。
 */
import { createWriteStream, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';

export interface FileEntry {
  size: number;
  name: string;
  fid: string;
  busid?: number;
  business_name?: string;
  upload_time?: number;
}

/** 人类可读的大小 */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '?';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[i]}`;
}

export interface FileFilter {
  keyword?: string;
  ext?: string;
  minSize?: number;
  maxSize?: number;
}

/** 按关键词（文件名子串，大小写不敏感）/ 扩展名 / 大小过滤 */
export function filterFiles(files: FileEntry[], filter: FileFilter = {}): FileEntry[] {
  const keyword = filter.keyword?.toLowerCase();
  const ext = filter.ext?.toLowerCase().replace(/^\./, '');

  return files.filter((f) => {
    if (keyword && !String(f.name ?? '').toLowerCase().includes(keyword)) return false;
    if (ext) {
      const nameExt = String(f.name ?? '').toLowerCase().split('.').pop() ?? '';
      if (nameExt !== ext) return false;
    }
    if (filter.minSize !== undefined && f.size < filter.minSize) return false;
    if (filter.maxSize !== undefined && f.size > filter.maxSize) return false;
    return true;
  });
}

export interface FileSummary {
  count: number;
  totalSize: number;
  byExt: { ext: string; count: number; size: number }[];
}

/** 汇总：数量、总大小、按扩展名分布 */
export function summarizeFiles(files: FileEntry[]): FileSummary {
  let totalSize = 0;
  const map = new Map<string, { count: number; size: number }>();
  for (const f of files) {
    totalSize += Number(f.size) || 0;
    const name = String(f.name ?? '');
    const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '(无扩展名)';
    const cur = map.get(ext) ?? { count: 0, size: 0 };
    cur.count += 1;
    cur.size += Number(f.size) || 0;
    map.set(ext, cur);
  }
  const byExt = [...map.entries()]
    .map(([ext, v]) => ({ ext, ...v }))
    .sort((a, b) => b.size - a.size);
  return { count: files.length, totalSize, byExt };
}

/** 把文件列表渲染成对齐的文本表 */
export function renderFileTable(files: FileEntry[], limit = 50): string {
  if (files.length === 0) return '（没有文件）';
  const shown = files.slice(0, limit);
  const lines = shown.map((f, i) => `${String(i + 1).padStart(3)}  ${formatSize(f.size).padStart(9)}  ${f.name}`);
  if (files.length > shown.length) lines.push(`… 还有 ${files.length - shown.length} 个未显示`);
  return lines.join('\n');
}

/** 从文件名或 fid 里找到目标文件（先精确名，再模糊，再 fid） */
export function findFile(files: FileEntry[], target: string): FileEntry | null {
  const exact = files.find((f) => f.name === target);
  if (exact) return exact;
  const byFid = files.find((f) => f.fid === target);
  if (byFid) return byFid;
  const lower = target.toLowerCase();
  const fuzzy = files.filter((f) => String(f.name ?? '').toLowerCase().includes(lower));
  return fuzzy.length === 1 ? fuzzy[0] : null;
}

/**
 * 下载到本地目录。文件名做最小净化，避免路径穿越。
 * @returns 落盘的绝对路径
 */
export async function downloadFile(url: string, outDir: string, name: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  mkdirSync(outDir, { recursive: true });
  const safe = String(name ?? 'file').replace(/[\\/:*?"<>|]/g, '_').slice(0, 120) || 'file';
  const dest = join(outDir, safe);

  const res = await fetchImpl(url, { signal: AbortSignal.timeout(300_000) });
  if (!res.ok || !res.body) throw new Error(`下载失败 HTTP ${res.status}`);
  await pipeline(res.body as any, createWriteStream(dest));
  return dest;
}
