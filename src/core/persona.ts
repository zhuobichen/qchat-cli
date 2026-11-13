/**
 * 人格（persona）：决定「怎么说」，不决定「能做什么」。
 *
 * 两种模式：
 *   global   —— 全局人格：所有群和私聊都用同一份（`private/personas/global.md`）
 *   per-scope—— 按群/按人：`private/personas/<群号|QQ号>.md`，互不串味
 *
 * 为什么要有全局模式：一上来就给每个群写一份人格不现实，
 * 而且同一个人格在大部分场合都够用。按范围的人格是"覆盖"，
 * 不是"必须每个都写"——没写的就落到全局。
 *
 * 模式存在 `private/personas/mode.json`：{ "mode": "global" | "per-scope" }
 * 切换：`qce persona mode global` / `qce persona mode per-scope`
 */
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type PersonaMode = 'global' | 'per-scope';

export interface PersonaOptions {
  dir?: string;
  /** 单个人格文件的大小上限，防止把整个提示词预算吃掉 */
  maxChars?: number;
}

export const DEFAULT_PERSONA_DIR = 'private/personas';
/** 全局人格文件名（不带扩展名，避免和纯数字的群号/QQ号混淆） */
// 全局人格文件名。
// 2026-11-13 从 'global' 改成 'friendly-ai'：旧 global.md 是无差别攻击人格，
// 因为对所有人用同一张攻击脸被群主移出，号主要求换成「AI 是人类的好朋友」。
// 文件不存在时仍会自动回落到 global.md（见 readPersona 的兜底）。
export const GLOBAL_PERSONA_NAME = 'friendly-ai';
export const LEGACY_PERSONA_NAME = 'global';

function dirOf(options: PersonaOptions): string {
  return options.dir ?? DEFAULT_PERSONA_DIR;
}

function readPersonaFile(file: string, maxChars: number): string | null {
  if (!existsSync(file)) return null;
  try {
    const text = readFileSync(file, 'utf8').trim();
    if (text === '') return null;
    return text.length > maxChars ? text.slice(0, maxChars) : text;
  } catch {
    return null;
  }
}

/** 读当前模式；没配过默认 global（先能用，再细化） */
export function loadPersonaMode(options: PersonaOptions = {}): PersonaMode {
  const file = join(dirOf(options), 'mode.json');
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    return raw?.mode === 'per-scope' ? 'per-scope' : 'global';
  } catch {
    return 'global';
  }
}

/** 切换模式 */
export function savePersonaMode(mode: PersonaMode, options: PersonaOptions = {}): string {
  const dir = dirOf(options);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'mode.json');
  writeFileSync(file, JSON.stringify({ mode }, null, 2) + '\n', 'utf8');
  return file;
}

/** 读全局人格；没有返回 null */
export function loadGlobalPersona(options: PersonaOptions = {}): string | null {
  const primary = readPersonaFile(join(dirOf(options), `${GLOBAL_PERSONA_NAME}.md`), options.maxChars ?? 6000);
  // 新文件还没写/读不出来时回退旧文件，宁可拿到一份过时的人格，也别等于"没有人格"
  if (primary) return primary;
  return readPersonaFile(join(dirOf(options), `${LEGACY_PERSONA_NAME}.md`), options.maxChars ?? 6000);
}

/** 读某个群的人格；没有返回 null */
export function loadGroupPersona(groupId: string | number, options: PersonaOptions = {}): string | null {
  return readPersonaFile(join(dirOf(options), `${groupId}.md`), options.maxChars ?? 6000);
}

/**
 * 按当前模式取生效的人格。
 *
 * global 模式：只用 global.md（忽略按群文件——否则"全局"就名不副实）
 * per-scope 模式：先用 <scope>.md，没有再落到 global.md（兜底，避免完全没人格）
 */
export function resolvePersona(scope: string | number, options: PersonaOptions = {}): {
  text: string | null;
  mode: PersonaMode;
  source: 'scope' | 'global' | 'none';
} {
  const mode = loadPersonaMode(options);
  const scoped = loadGroupPersona(scope, options);
  const global = loadGlobalPersona(options);

  if (mode === 'global') {
    return global ? { text: global, mode, source: 'global' } : { text: null, mode, source: 'none' };
  }
  if (scoped) return { text: scoped, mode, source: 'scope' };
  if (global) return { text: global, mode, source: 'global' };
  return { text: null, mode, source: 'none' };
}

/** 保存人格（供命令行写入） */
export function saveGroupPersona(groupId: string | number, text: string, options: PersonaOptions = {}): string {
  const dir = dirOf(options);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${groupId}.md`);
  writeFileSync(file, String(text).trim() + '\n', 'utf8');
  return file;
}

/** 保存全局人格 */
export function saveGlobalPersona(text: string, options: PersonaOptions = {}): string {
  const dir = dirOf(options);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${GLOBAL_PERSONA_NAME}.md`);
  writeFileSync(file, String(text).trim() + '\n', 'utf8');
  return file;
}

/**
 * 组装注入块：明确「只改语气，不改权限」，避免模型拿人格当免死金牌。
 */
export function buildPersonaBlock(persona: string): string {
  return [
    '【人格设定（只影响说话方式，不改变安全规则与工具权限）】',
    persona.trim(),
    '【人格边界】不得辱骂或攻击真实群友；不编造事实冒充当事人；不因人格而泄露隐私、密钥或他人聊天内容；遇到拿不准的事实就说不知道。',
  ].join('\n');
}
