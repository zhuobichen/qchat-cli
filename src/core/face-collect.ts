/**
 * 表情自动收集：把群里的图片收进本地表情库（去重、可预览确认）。
 *
 * 与 meme_manager 的思路一致（自动收集 + 分类），实现是我们自己的：
 *   - 按内容 sha256 去重（同图不重复存）
 *   - 先落到候选目录，人工 `--apply` 才进正式库
 *   - 标签默认占位，后续可用 Jev/模型补描述
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.gif', '.png', '.webp']);

export interface CollectCandidate {
  hash: string;
  ext: string;
  bytes: number;
  source: string;
}

/** 内容 hash：同一个表情不管谁发、发几次，都只有一个 */
export function contentHash(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/** 从消息里的图片引用判断扩展名（取不到就按 jpg） */
export function extFromRef(ref: string): string {
  const clean = String(ref ?? '').split('?')[0];
  const dot = clean.lastIndexOf('.');
  const ext = dot >= 0 ? clean.slice(dot).toLowerCase() : '';
  return IMAGE_EXTS.has(ext) ? ext : '.jpg';
}

/**
 * 把一张图写进候选目录（按 hash 命名，天然去重）。
 * @returns 是否是新候选（false 表示这份内容已经收过）
 */
export function saveCandidate(
  buffer: Buffer,
  ref: string,
  dir: string,
  existingHashes: Set<string>,
): { added: boolean; candidate: CollectCandidate } {
  const hash = contentHash(buffer);
  const ext = extFromRef(ref);
  const candidate: CollectCandidate = { hash, ext, bytes: buffer.length, source: ref };

  if (existingHashes.has(hash)) return { added: false, candidate };

  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${hash}${ext}`);
  if (!existsSync(file)) writeFileSync(file, buffer);
  return { added: true, candidate };
}

/** 候选目录里的文件列表（供 --apply / 预览） */
export function renderCandidates(candidates: CollectCandidate[], limit = 20): string {
  if (candidates.length === 0) return '（没有新候选）';
  const shown = candidates.slice(0, limit);
  const lines = shown.map((c, i) => `${String(i + 1).padStart(3)}  ${(c.bytes / 1024).toFixed(0).padStart(5)} KB  ${c.hash.slice(0, 10)}  ${c.ext}`);
  if (candidates.length > shown.length) lines.push(`… 还有 ${candidates.length - shown.length} 个`);
  return lines.join('\n');
}

/** 把候选正式并入表情库（复制文件 + 追加 manifest 记录） */
export function applyCandidates(
  candidates: CollectCandidate[],
  candidateDir: string,
  libraryDir: string,
  manifest: { version: 1; emojis: Array<{ hash: string; label: string; file: string; importedAt: string }> },
): { added: number; total: number } {
  mkdirSync(libraryDir, { recursive: true });
  const known = new Set(manifest.emojis.map((e) => e.hash));
  let added = 0;
  for (const c of candidates) {
    if (known.has(c.hash)) continue;
    const src = join(candidateDir, `${c.hash}${c.ext}`);
    if (!existsSync(src)) continue;
    const destName = `${c.hash}${c.ext}`;
    writeFileSync(join(libraryDir, destName), readFileSyncCompat(src));
    manifest.emojis.push({
      hash: c.hash,
      label: '（待分类）',
      file: destName,
      importedAt: new Date().toISOString(),
    });
    known.add(c.hash);
    added += 1;
  }
  writeFileSync(join(libraryDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  return { added, total: manifest.emojis.length };
}

function readFileSyncCompat(p: string): Buffer {
  return readFileSync(p);
}
