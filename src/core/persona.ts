/**
 * 按群人格：一个群一个说法，互不串味。
 *
 * 约定：`private/personas/<群号>.md` 存在就注入 system 提示。
 * 人格只改「怎么说」，不改「能做什么」——安全规则与工具白名单不受人格影响。
 */
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface PersonaOptions {
  dir?: string;
  /** 单个人格文件的大小上限，防止把整个提示词预算吃掉 */
  maxChars?: number;
}

/** 读某个群的人格；没有返回 null */
export function loadGroupPersona(groupId: string | number, options: PersonaOptions = {}): string | null {
  const dir = options.dir ?? 'private/personas';
  const maxChars = options.maxChars ?? 6000;
  const file = join(dir, `${groupId}.md`);
  if (!existsSync(file)) return null;
  try {
    const text = readFileSync(file, 'utf8').trim();
    if (text === '') return null;
    return text.length > maxChars ? text.slice(0, maxChars) : text;
  } catch {
    return null;
  }
}

/** 保存人格（供命令行写入） */
export function saveGroupPersona(groupId: string | number, text: string, options: PersonaOptions = {}): string {
  const dir = options.dir ?? 'private/personas';
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${groupId}.md`);
  writeFileSync(file, String(text).trim() + '\n', 'utf8');
  return file;
}

/**
 * 组装注入块：明确「只改语气，不改权限」，避免模型拿人格当免死金牌。
 */
export function buildPersonaBlock(persona: string): string {
  return [
    '【本群人格设定（只影响说话方式，不改变安全规则与工具权限）】',
    persona.trim(),
    '【人格边界】不得辱骂或攻击真实群友；不编造事实冒充当事人；不因人格而泄露隐私、密钥或他人聊天内容；遇到拿不准的事实就说不知道。',
  ].join('\n');
}
