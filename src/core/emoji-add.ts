/**
 * 把一个目录直接导进本地表情库（`private/emoji-library/`）。
 *
 * 与 `qce face import` 的区别：
 *   - `face import`   → 上传到 QQ 收藏表情（走腾讯 API，慢、有限速）
 *   - `face add`      → 只进本地库，`send_sticker` / Jev 选图马上能用（无需账号）
 *
 * 用途：自己攒的表情包（比如 DeepSeek 那批）筛好之后一条命令接进来。
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

export interface AddedFile {
  hash: string;
  file: string;
  bytes: number;
  label: string;
}

/** 按魔数判断真实格式（扩展名经常标错） */
export function detectExt(buf: Buffer): string {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50) return '.png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8) return '.jpg';
  if (buf.length >= 6 && buf.slice(0, 3).toString('ascii') === 'GIF') return '.gif';
  if (buf.length >= 12 && buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return '.webp';
  return '.png';
}

/**
 * 把目录里的图片加到本地库。
 *
 * @param labelPrefix 标签前缀。取图时靠 label 做关键词匹配，所以建议给个有意义的
 *                    前缀（比如「DeepSeek」），后面可以用 `qce face label` 补细描述。
 */
export function addDirectoryToLibrary(
  srcDir: string,
  libraryDir: string,
  manifest: { version: 1; emojis: Array<{ hash: string; label: string; file: string; importedAt: string }> },
  options: { labelPrefix?: string; maxBytes?: number } = {},
): { added: AddedFile[]; skipped: Array<{ file: string; reason: string }> } {
  const maxBytes = options.maxBytes ?? 2 * 1024 * 1024;
  const prefix = (options.labelPrefix ?? '').trim();
  const known = new Set(manifest.emojis.map((e) => e.hash));
  const added: AddedFile[] = [];
  const skipped: Array<{ file: string; reason: string }> = [];

  mkdirSync(libraryDir, { recursive: true });

  for (const name of readdirSync(srcDir)) {
    const full = join(srcDir, name);
    const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
    if (!IMAGE_EXTS.has(ext)) continue;

    const buf = readFileSync(full);
    if (buf.length > maxBytes) {
      skipped.push({ file: name, reason: `超过 ${Math.round(maxBytes / 1024 / 1024)}MB` });
      continue;
    }
    const hash = createHash('sha256').update(buf).digest('hex');
    if (known.has(hash)) {
      skipped.push({ file: name, reason: '已存在（内容相同）' });
      continue;
    }

    const realExt = detectExt(buf);
    const destName = `${hash}${realExt}`;
    writeFileSync(join(libraryDir, destName), buf);

    // 标签：前缀 + 原文件名（去掉扩展名），方便以后按关键词搜到
    const base = name.slice(0, name.lastIndexOf('.')) || name;
    const label = prefix ? `${prefix} ${base}` : base;

    manifest.emojis.push({
      hash,
      label,
      file: destName,
      importedAt: new Date().toISOString(),
    });
    known.add(hash);
    added.push({ hash, file: destName, bytes: buf.length, label });
  }

  writeFileSync(join(libraryDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  return { added, skipped };
}

/** 读 manifest（不存在返回空） */
export function loadLibraryManifest(libraryDir: string): { version: 1; emojis: Array<{ hash: string; label: string; file: string; importedAt: string }> } {
  const p = join(libraryDir, 'manifest.json');
  if (!existsSync(p)) return { version: 1, emojis: [] };
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8'));
    if (Array.isArray(parsed?.emojis)) return parsed;
  } catch {
    /* 坏文件当空处理 */
  }
  return { version: 1, emojis: [] };
}
