import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 偷表情包：别人在群里发的图，看着像表情包就存进自己的库。
 *
 * 为什么这条最"像人"：真人看到好图会存下来，以后拿来用。
 * 而且我们的表情库管道已经现成（hash 去重 + 标签 + 语义检索），
 * 差的就是"从消息里捡图"这一步。
 *
 * 三个必须守住的红线：
 *   ① 不是所有图都收 —— 截图、照片、二维码、长图一律不收
 *   ② 不能收太多 —— 一个群一天最多收 N 张，否则库里塞满垃圾
 *   ③ 要能追溯 —— 记下这张图是从哪个群、谁发的，以后能说"这是从你那偷的"
 */

export interface StealCandidate {
  buffer: Buffer;
  /** 谁发的 */
  fromUin?: string;
  fromName?: string;
  /** 哪个群/私聊 */
  scope?: string;
  /** 消息里附带的文字（可能为空） */
  text?: string;
  /** 指定标签；不给就自动生成「偷来的 <来源>」 */
  label?: string;
}

export interface StealVerdict {
  accept: boolean;
  reason: string;
}

/** 表情包的体积上限：超过 2MB 的通常是图不是表情 */
const MAX_BYTES = 2 * 1024 * 1024;
/** 太小的（图标/贴图碎片）也没意义 */
const MIN_BYTES = 800;

/**
 * 判断这张图值不值得收。
 *
 * 判据都是"能直接量出来的"：
 *   体积、是否动图、长宽比、是否带文字以外的信息。
 *
 * 故意保守——宁可漏收，也不要把群里的截图和照片塞进表情库。
 */
export function judgeStealable(input: {
  buffer: Buffer;
  width?: number;
  height?: number;
  isAnimated?: boolean;
  /** 消息里除了图还有多少字 */
  textLen?: number;
  /**
   * 严格模式。
   *
   * 什么时候用：消息里的图片段**没有**表情包特征（sub_type 不是 1、summary 不是 [xxx]）。
   * 这时候它很可能是照片、截图、或者别人转发的一张图，标准要收紧——
   * 否则群里的手机截图（800x1200）会被当成表情收进来。
   */
  strict?: boolean;
}): StealVerdict {
  const { buffer, width, height, isAnimated } = input;
  const size = buffer.length;

  if (size < MIN_BYTES) return { accept: false, reason: `太小（${size}B）` };
  if (size > MAX_BYTES) return { accept: false, reason: `太大（${Math.round(size / 1024)}KB）` };

  // 动图基本就是表情包，直接收
  if (isAnimated) return { accept: true, reason: '动图' };

  if (width && height) {
    const ratio = width / height;
    if (width < 80 || height < 80) return { accept: false, reason: `${width}x${height} 太小` };
    // 长图/长截图
    if (ratio < 0.4 || ratio > 2.5) return { accept: false, reason: `长宽比 ${ratio.toFixed(2)} 不像表情` };
    // 超大分辨率的通常是照片或截图
    if (width * height > 2_500_000) return { accept: false, reason: `${width}x${height} 分辨率过高` };
    if (input.strict) {
      // 没有表情包特征时：只收"标准表情尺寸"的图。
      // 手机截图基本都在 700 以上，这一条能把它们挡掉大部分。
      if (width > 800 || height > 800) {
        return { accept: false, reason: `${width}x${height} 偏大，不像表情（可能是截图）` };
      }
      if (width * height >= 640_000) {
        return { accept: false, reason: `${width}x${height} 像素偏多（可能是照片）` };
      }
    }
  }

  return { accept: true, reason: '像表情包' };
}

/** 从字节里读 PNG/JPEG/GIF/WEBP 的宽高（不依赖图像库） */
export function probeImageSize(buf: Buffer): { width?: number; height?: number; animated?: boolean } {
  try {
    // PNG: IHDR 在 0x10 起
    if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50) {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    // GIF: 宽高在 6..10，且可能多帧
    if (buf.length > 10 && buf.slice(0, 3).toString('ascii') === 'GIF') {
      const frames = buf.toString('ascii').match(/NETSCAPE2\.0|GCE/g);
      return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8), animated: (frames?.length ?? 0) > 1 };
    }
    // WEBP
    if (buf.length > 30 && buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') {
      const kind = buf.slice(12, 16).toString('ascii');
      if (kind === 'VP8X') {
        const w = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
        const h = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
        const animated = (buf[20] & 0x02) !== 0;
        return { width: w, height: h, animated };
      }
      if (kind === 'VP8 ') {
        return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
      }
    }
    // JPEG: 扫 SOFn
    if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
      let i = 2;
      while (i < buf.length - 9) {
        if (buf[i] !== 0xff) {
          i += 1;
          continue;
        }
        const marker = buf[i + 1];
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
        }
        const segLen = buf.readUInt16BE(i + 2);
        i += 2 + segLen;
      }
    }
  } catch {
    /* 读不出来就当不知道 */
  }
  return {};
}

export function detectImageExt(buf: Buffer): string {
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50) return '.png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8) return '.jpg';
  if (buf.length >= 6 && buf.slice(0, 3).toString('ascii') === 'GIF') return '.gif';
  if (buf.length >= 12 && buf.slice(8, 12).toString('ascii') === 'WEBP') return '.webp';
  return '.png';
}

export function hashBuffer(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

// ══════════════════════════════════════════════════════════════
// 限流：一个群一天最多收几张
// ══════════════════════════════════════════════════════════════

export interface StealQuota {
  /** scope → 日期(yyyy-mm-dd) → 已收数量 */
  counts: Record<string, Record<string, number>>;
}

export const DEFAULT_QUOTA_PATH = 'private/.sticker-steal-quota.json';
export const DEFAULT_DAILY_LIMIT = 8;

function todayKey(now = Date.now()): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function loadQuota(path = DEFAULT_QUOTA_PATH): StealQuota {
  try {
    if (!existsSync(path)) return { counts: {} };
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    return { counts: raw?.counts ?? {} };
  } catch {
    return { counts: {} };
  }
}

export function saveQuota(quota: StealQuota, path = DEFAULT_QUOTA_PATH): void {
  try {
    writeFileSync(path, JSON.stringify(quota, null, 2), 'utf8');
  } catch {
    /* 记不下来不影响 */
  }
}

/** 今天这个 scope 还能收几张 */
export function remainingQuota(scope: string, limit = DEFAULT_DAILY_LIMIT, quota = loadQuota(), now = Date.now()): number {
  const used = quota.counts[scope]?.[todayKey(now)] ?? 0;
  return Math.max(0, limit - used);
}

export function consumeQuota(scope: string, quota = loadQuota(), now = Date.now()): void {
  const day = todayKey(now);
  quota.counts[scope] = quota.counts[scope] ?? {};
  quota.counts[scope][day] = (quota.counts[scope][day] ?? 0) + 1;
  // 只留最近 7 天，避免文件无限长
  const keys = Object.keys(quota.counts[scope]).sort();
  while (keys.length > 7) {
    const old = keys.shift()!;
    delete quota.counts[scope][old];
  }
}

// ══════════════════════════════════════════════════════════════
// 入库
// ══════════════════════════════════════════════════════════════

export interface LibraryManifest {
  version: 1;
  emojis: Array<{
    hash: string;
    label: string;
    file: string;
    importedAt: string;
    /** 偷来的记来源，自己导入的没有 */
    stolenFrom?: { uin?: string; name?: string; scope?: string; at: string };
  }>;
}

export function loadManifestAt(path: string): LibraryManifest {
  if (!existsSync(path)) return { version: 1, emojis: [] };
  return JSON.parse(readFileSync(path, 'utf8')) as LibraryManifest;
}

export interface StealResult {
  added: boolean;
  reason: string;
  hash?: string;
  label?: string;
}

/**
 * 把一张图存进表情库。
 *
 * @param libraryDir 表情库目录（一般是 private/emoji-library）
 * @param label 标签。没有就用「偷来的 <来源>」占位，等后面的打标脚本补
 */
export function addStolenSticker(
  libraryDir: string,
  candidate: StealCandidate,
  options: { label?: string; now?: number; manifestPath?: string } = {},
): StealResult {
  const buf = candidate.buffer;
  const hash = hashBuffer(buf);

  const manifestPath = options.manifestPath ?? join(libraryDir, 'manifest.json');
  const manifest = loadManifestAt(manifestPath);

  if (manifest.emojis.some((e) => e.hash === hash)) {
    return { added: false, reason: '已经有了', hash };
  }

  const ext = detectImageExt(buf);
  const size = probeImageSize(buf);
  const verdict = judgeStealable({
    buffer: buf,
    width: size.width,
    height: size.height,
    isAnimated: size.animated,
    textLen: candidate.text?.length ?? 0,
  });
  if (!verdict.accept) return { added: false, reason: verdict.reason, hash };

  mkdirSync(libraryDir, { recursive: true });
  const fileName = `${hash}${ext}`;
  writeFileSync(join(libraryDir, fileName), buf);

  const at = new Date(options.now ?? Date.now()).toISOString();
  // 标签优先用调用方给的，其次自动生成。自动的只标来源，具体含义等打标脚本补。
  const label =
    candidate.label ||
    options.label ||
    `偷来的${candidate.fromName ? ` ${candidate.fromName}` : ''}${size.animated ? ' 动图' : ''}`.trim();

  manifest.emojis.push({
    hash,
    label,
    file: fileName,
    importedAt: at,
    ...(candidate.scope || candidate.fromUin
      ? {
          stolenFrom: {
            ...(candidate.fromUin ? { uin: candidate.fromUin } : {}),
            ...(candidate.fromName ? { name: candidate.fromName } : {}),
            ...(candidate.scope ? { scope: candidate.scope } : {}),
            at,
          },
        }
      : {}),
  });
  manifest.version = 1;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  return { added: true, reason: verdict.reason, hash, label };
}
