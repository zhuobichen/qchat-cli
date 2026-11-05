/**
 * 图片 OCR：把图片里的文字识别出来，作为「合成消息」并入索引。
 *
 * 为什么合成消息：MessageStore 只追加不修改，直接把 OCR 文本做成
 * id = `ocr:<消息id>:<序号>` 的独立记录，既能被搜索/日报/语义检索自然复用，
 * 又天然幂等（重复跑不会重复入库）。
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export interface OcrResult {
  file: string;
  text: string;
  lines: string[];
  error?: string;
}

/** 默认脚本路径：以本模块位置为基准找 scripts/ocr_image.py */
export function defaultOcrScript(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'ocr_image.py');
}

/**
 * 调 Python 侧 OCR。失败返回空 map（调用方决定是否告警），不抛。
 */
export function runOcr(
  files: string[],
  options: { python?: string; script?: string; timeoutMs?: number } = {},
): OcrResult[] {
  if (files.length === 0) return [];
  const python = options.python || process.env.QCE_PYTHON || 'python';
  const script = options.script || process.env.QCE_OCR_SCRIPT || defaultOcrScript();
  if (!existsSync(script)) return [];

  const r = spawnSync(python, [script, ...files], {
    encoding: 'utf8',
    timeout: options.timeoutMs ?? 180_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (r.status !== 0 || !r.stdout) return [];

  try {
    const parsed = JSON.parse(r.stdout);
    return Array.isArray(parsed?.results) ? parsed.results : [];
  } catch {
    return [];
  }
}

/** 把 OCR 结果做成可入库的合成消息记录 */
export function toSyntheticMessages(
  base: { id: string; groupId?: number; time: number; senderId: number; senderName: string },
  ocr: OcrResult[],
): { id: string; groupId: number; time: number; senderId: number; senderName: string; text: string }[] {
  const out = [];
  let index = 0;
  for (const item of ocr) {
    const text = (item.text || '').trim();
    if (!text) continue;
    out.push({
      id: `ocr:${base.id}:${index}`,
      groupId: base.groupId ?? 0,
      time: base.time,
      senderId: base.senderId,
      senderName: base.senderName,
      text: `[图片文字] ${text}`,
    });
    index += 1;
  }
  return out;
}

/** 判断一条消息是否已经做过 OCR（有合成消息 id 前缀） */
export function hasOcrEntries(messageId: string, ids: Set<string>): boolean {
  for (const id of ids) {
    if (id.startsWith(`ocr:${messageId}:`)) return true;
  }
  return false;
}
