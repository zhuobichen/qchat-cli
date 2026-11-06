/**
 * 表情自动打标：给「（待分类）」的表情补上描述。
 *
 * 用视觉模型看图生成一句话描述，写回 manifest 的 label。
 * 纯逻辑（提示词、结果清洗、筛选待标项）与网络分开，便于单测。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface EmojiRecord {
  hash: string;
  label: string;
  file: string;
  importedAt: string;
}

export interface EmojiManifest {
  version: 1;
  emojis: EmojiRecord[];
}

/** 「（待分类）」与空标签都视为待标 */
export function needsLabel(record: EmojiRecord): boolean {
  const label = String(record.label ?? '').trim();
  return label === '' || label.includes('待分类') || label === '未分类';
}

/** 从 manifest 里挑出待标项（可限制数量） */
export function pickUnlabeled(manifest: EmojiManifest, limit = 10): EmojiRecord[] {
  return manifest.emojis.filter(needsLabel).slice(0, Math.max(1, limit));
}

export const LABEL_PROMPT =
  '这是一张聊天表情包。用不超过 20 个字的中文描述它表达的情绪或用途，只输出描述本身，不要加引号、不要解释。例如：无语翻白眼、庆祝撒花、嘲讽微笑。';

/** 调 OpenAI 兼容的视觉模型，返回一句话描述（失败返回 null） */
export async function describeImage(
  imageBytes: Buffer,
  options: { apiKey: string; model?: string; baseUrl?: string; fetchImpl?: typeof fetch; timeoutMs?: number },
): Promise<string | null> {
  if (!options.apiKey || imageBytes.length === 0) return null;
  const base = (options.baseUrl ?? process.env.QCE_VISION_BASE ?? 'https://api.302ai.cn/v1').replace(/\/$/, '');
  const fetchImpl = options.fetchImpl ?? fetch;
  const mime = imageBytes.slice(0, 4).toString('hex').startsWith('89504e47') ? 'image/png' : 'image/jpeg';

  try {
    const res = await fetchImpl(`${base}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: options.model ?? 'qwen-vl-max',
        max_tokens: 60,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: LABEL_PROMPT },
            { type: 'image_url', image_url: { url: `data:${mime};base64,${imageBytes.toString('base64')}` } },
          ],
        }],
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 60_000),
    });
    if (!res.ok) return null;
    const json: any = await res.json();
    const text = String(json?.choices?.[0]?.message?.content ?? '').trim();
    return cleanLabel(text);
  } catch {
    return null;
  }
}

/** 清洗模型输出：去引号、去前缀、限长 */
export function cleanLabel(raw: string): string | null {
  let t = String(raw ?? '').trim();
  t = t.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '');
  t = t.replace(/^(这张|该)?表情包?[:：]\s*/, '');   // 只去掉带冒号的前缀
  t = t.replace(/\s*[\r\n]+\s*/g, ' ');
  if (t === '') return null;
  return t.length > 20 ? t.slice(0, 20) : t;
}

/** 写回 manifest（调用方负责传入完整对象） */
export function saveManifest(path: string, manifest: EmojiManifest): void {
  writeFileSync(path, JSON.stringify(manifest, null, 2), 'utf8');
}

export function loadManifestFile(path: string): EmojiManifest {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (Array.isArray(parsed?.emojis)) return parsed;
  } catch {
    /* 落到空 manifest */
  }
  return { version: 1, emojis: [] };
}

/** 读表情文件字节（不存在返回 null） */
export function readEmojiBytes(libraryDir: string, record: EmojiRecord): Buffer | null {
  const p = join(libraryDir, record.file);
  return existsSync(p) ? readFileSync(p) : null;
}
