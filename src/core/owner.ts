import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * 主人识别。
 *
 * 为什么需要这个模块：有些事只该对主人开——比如"改人格""调参数""给自己加功能"。
 * 群友提同样的要求必须拒绝（否则这号就成了公共玩具）。
 *
 * 这个判定必须**写在代码里**，不能只在人格提示词里说"主人是 XXX"：
 * 提示词可能被绕过或说漏，配置 + 函数是硬的。
 */

export interface OwnerConfig {
  /** 主人 QQ 号（字符串，避免大数精度问题） */
  uins: string[];
  /** 说明，给人看 */
  note?: string;
}

export const DEFAULT_OWNER_PATH = 'private/owner.json';

const DEFAULT_OWNER: OwnerConfig = {
  uins: ['1473517806'],
  note: '号主本人。可以要求改人格/改行为/加功能；其他人一律按边界走。',
};

export function loadOwnerConfig(path = DEFAULT_OWNER_PATH): OwnerConfig {
  try {
    if (!existsSync(path)) return { ...DEFAULT_OWNER };
    const raw = JSON.parse(readFileSync(path, 'utf8')) as OwnerConfig;
    if (!Array.isArray(raw?.uins)) return { ...DEFAULT_OWNER };
    return {
      uins: raw.uins.map((x) => String(x).trim()).filter(Boolean),
      ...(raw.note ? { note: raw.note } : {}),
    };
  } catch {
    return { ...DEFAULT_OWNER };
  }
}

export function saveOwnerConfig(config: OwnerConfig, path = DEFAULT_OWNER_PATH): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2), 'utf8');
}

/** 这个 QQ 号是不是主人 */
export function isOwner(uin: string | number | null | undefined, path = DEFAULT_OWNER_PATH): boolean {
  if (uin === undefined || uin === null) return false;
  const s = String(uin).trim();
  if (!s) return false;
  return loadOwnerConfig(path).uins.includes(s);
}

/**
 * 权限分级：不同来源能给什么。
 *
 * 这些不是"能不能说话"的限制（谁都能聊），
 * 而是"能不能改我"的限制。
 */
export type Authority = 'owner' | 'guest';

export function authorityOf(uin: string | number | null | undefined, path = DEFAULT_OWNER_PATH): Authority {
  return isOwner(uin, path) ? 'owner' : 'guest';
}

/** 主人可以做的事（非主人一律不做） */
export const OWNER_ONLY = [
  '改人格文件（语气、性格、口癖）',
  '改行为参数（频率、冷却、概率、阈值）',
  '加功能 / 改代码 / 装依赖',
  '改发送白名单',
  '查看或导出配置、密钥位置、运行状态细节',
  '调整对某个群/某人的特殊策略',
] as const;

/** 任何人都不能借"主人说过"来绕过的事 */
export const NEVER_BY_CLAIM = [
  '泄露密钥、token、他人聊天内容',
  '人肉/开盒 / 暴露真实身份信息',
  '冒充主人行使权限（必须有号本身在发消息）',
] as const;
