import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { createHash } from 'crypto';
import { extname, resolve } from 'path';
import { describeEmoji, type GroupBotModelConfig } from './group-agent.js';

interface EmojiRecord { hash: string; label: string; file: string; importedAt: string; }
interface EmojiManifest { version: 1; emojis: EmojiRecord[]; }
const LIBRARY_DIR = resolve('private/emoji-library');
const MANIFEST_PATH = resolve(LIBRARY_DIR, 'manifest.json');
const ALLOWED = new Set(['.jpg', '.jpeg', '.gif', '.png', '.webp']);

function loadManifest(): EmojiManifest {
  try { return JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8')) as EmojiManifest; } catch { return { version: 1, emojis: [] }; }
}

export function searchEmojiLibrary(query: string, limit: number = 5): Array<{ id: string; label: string; animated: boolean }> {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return loadManifest().emojis
    .map((emoji) => ({ emoji, score: terms.reduce((score, term) => score + (emoji.label.toLowerCase().includes(term) ? 2 : 0), 0) }))
    .sort((a, b) => b.score - a.score || b.emoji.importedAt.localeCompare(a.emoji.importedAt))
    .slice(0, Math.min(Math.max(limit, 1), 5))
    .map(({ emoji }) => ({ id: emoji.hash, label: emoji.label, animated: emoji.file.endsWith('.gif') }));
}

export function emojiPath(id: string): string | null {
  if (!/^[a-f0-9]{64}$/.test(id)) return null;
  const emoji = loadManifest().emojis.find((item) => item.hash === id);
  if (!emoji) return null;
  const path = resolve(LIBRARY_DIR, emoji.file);
  return existsSync(path) ? path : null;
}
function mimeFor(extension: string): string { return extension === '.gif' ? 'image/gif' : extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : 'image/jpeg'; }

export async function syncEmojiLibrary(config: GroupBotModelConfig, progress?: (text: string) => void): Promise<{ added: number; total: number }> {
  if (!config.emojiSourceDirectory || !existsSync(config.emojiSourceDirectory)) throw new Error('表情来源目录不存在');
  if (!existsSync(LIBRARY_DIR)) mkdirSync(LIBRARY_DIR, { recursive: true, mode: 0o700 });
  const manifest = loadManifest();
  const known = new Set(manifest.emojis.map((item) => item.hash));
  const files = readdirSync(config.emojiSourceDirectory, { withFileTypes: true }).filter((item) => item.isFile() && ALLOWED.has(extname(item.name).toLowerCase()));
  const pending: Array<{ source: string; bytes: Buffer; hash: string; extension: string }> = [];
  for (const entry of files) {
    const source = resolve(config.emojiSourceDirectory, entry.name);
    const bytes = readFileSync(source);
    if (bytes.length > 5 * 1024 * 1024) continue;
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (known.has(hash)) continue;
    pending.push({ source, bytes, hash, extension: extname(entry.name).toLowerCase() });
  }
  let added = 0;
  let cursor = 0;
  const worker = async () => {
    while (true) {
      const item = pending[cursor++];
      if (!item) return;
      progress?.(`识别表情 ${added + 1}/${pending.length}`);
      try {
        const label = await describeEmoji(item.bytes, mimeFor(item.extension), config);
        const file = `${item.hash}${item.extension}`;
        copyFileSync(item.source, resolve(LIBRARY_DIR, file));
        manifest.emojis.push({ hash: item.hash, label, file, importedAt: new Date().toISOString() });
        known.add(item.hash);
        added += 1;
        const tempManifest = `${MANIFEST_PATH}.${process.pid}.tmp`;
        writeFileSync(tempManifest, JSON.stringify(manifest, null, 2), { encoding: 'utf-8', mode: 0o600 });
        renameSync(tempManifest, MANIFEST_PATH);
      } catch {
        progress?.('跳过暂时无法识别的表情');
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(config.emojiVisionConcurrency, pending.length) }, worker));
  return { added, total: manifest.emojis.length };
}
