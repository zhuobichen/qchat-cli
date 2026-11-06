/**
 * 把群成员画像接入长期记忆 + 上下文注入。
 *
 * 画像是「由历史统计得出」的事实，不是模型猜的——
 * 所以它进记忆时权重给高（不容易被淡忘），进上下文时标注来源。
 */
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MemoryStore } from './memory.js';
import { buildProfiles, renderProfiles, type MemberProfile } from './member-profile.js';
import { parseHistoryFile } from './historyfile.js';

export const PROFILE_DIR = 'private/profiles';

/** 从历史文件生成画像并落盘 */
export function generateProfiles(groupId: string | number, historyFile: string): MemberProfile[] {
  const parsed = parseHistoryFile(readFileSync(historyFile, 'utf8'));
  const profiles = buildProfiles(parsed.records);
  mkdirSync(PROFILE_DIR, { recursive: true });
  writeFileSync(join(PROFILE_DIR, `${groupId}.json`), JSON.stringify(profiles, null, 2), 'utf8');
  return profiles;
}

/** 读已存画像 */
export function loadProfiles(groupId: string | number): MemberProfile[] | null {
  const file = join(PROFILE_DIR, `${groupId}.json`);
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * 把画像写进长期记忆（scope = 群号）。
 * 每条画像一条记忆，权重 0.85（事实类，衰减慢）。
 */
export function profilesToMemories(groupId: string | number, profiles: MemberProfile[]): number {
  const store = new MemoryStore(defaultIndexRoot());
  const now = Math.floor(Date.now() / 1000);
  let added = 0;
  for (const p of profiles.slice(0, 12)) {
    const bits = [`${p.nick}(${p.qq}) 在群里发言 ${p.messages} 条`];
    if (p.topHours.length) bits.push(`常在 ${p.topHours.map((h) => `${h}时`).join('/')} 出现`);
    if (p.topWords.length) bits.push(`爱说：${p.topWords.slice(0, 5).join('、')}`);
    if (p.catchphrases.length) bits.push(`口头禅：${p.catchphrases.slice(0, 3).join('、')}`);
    if (p.topPartners.length) bits.push(`常和：${p.topPartners.map((x) => x.nick).join('、')} 聊`);
    const { added: isNew } = store.remember({
      scope: `g${groupId}`,
      text: bits.join('；'),
      createdAt: now,
      weight: 0.85,
      tags: ['群成员画像', p.nick],
    });
    if (isNew) added += 1;
  }
  return added;
}

function defaultIndexRoot(): string {
  const home = process.env.QCE_INDEX_DIR;
  if (home) return home;
  try {
    const dir = join(process.env.APPDATA ?? '', 'qchat-cli-nodejs', 'Config');
    mkdirSync(dir, { recursive: true });
    return dir;
  } catch {
    return join(process.cwd(), '.qce-index');
  }
}

/** 渲染成可注入上下文的块 */
export function buildProfileBlock(groupId: string | number, limit = 6): string {
  const profiles = loadProfiles(groupId);
  if (!profiles || profiles.length === 0) return '';
  const text = renderProfiles(profiles.slice(0, limit));
  return text ? `${text}\n（以上来自历史聊天统计，可信；但不要在回复里直接念出来）` : '';
}
