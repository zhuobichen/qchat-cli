/**
 * 关键词告警：群消息命中规则时提醒到指定 QQ。
 *
 * 纯函数部分（匹配 / 去重 / 冷却）与 IO 分开，便于单测。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface AlertRule {
  id: string;
  /** 关键词（大小写不敏感）或正则源码 */
  pattern: string;
  regex?: boolean;
  /** 限定群，空表示所有已索引/监听的群 */
  groupId?: number;
  /** 命中后发到这个会话（QQ 号或群号） */
  to: string;
  /** 同一条规则在这个秒数内不重复提醒，默认 0 = 每条只提醒一次（按消息 id 去重） */
  cooldownSec?: number;
  enabled?: boolean;
}

export interface AlertMessage {
  id: string;
  groupId?: number;
  time: number;
  senderId: number;
  senderName: string;
  text: string;
}

export interface AlertState {
  /** 已提醒过的消息 id，防止重启后重复 */
  notified: Record<string, number>;
}

export function matchRule(rule: AlertRule, message: AlertMessage): boolean {
  if (rule.enabled === false) return false;
  if (rule.groupId !== undefined && message.groupId !== rule.groupId) return false;
  const text = message.text ?? '';
  if (rule.regex) {
    try {
      return new RegExp(rule.pattern, 'i').test(text);
    } catch {
      return false;
    }
  }
  return text.toLowerCase().includes(rule.pattern.toLowerCase());
}

/**
 * 从一批消息里挑出需要提醒的。
 * 去重键是「规则 id + 消息 id」，所以同一个消息不会因为重启再提醒一次。
 */
export function pickHits(
  rules: AlertRule[],
  messages: AlertMessage[],
  state: AlertState,
  now: number = Math.floor(Date.now() / 1000),
): { rule: AlertRule; message: AlertMessage }[] {
  const out: { rule: AlertRule; message: AlertMessage }[] = [];
  const seen = new Set<string>();

  for (const rule of rules) {
    const cooldown = rule.cooldownSec ?? 0;
    for (const message of messages) {
      const key = `${rule.id}:${message.id}`;
      if (state.notified[key] !== undefined) continue;
      if (seen.has(key)) continue;
      if (!matchRule(rule, message)) continue;
      if (cooldown > 0) {
        // 同一规则在冷却窗口内只提醒一次
        const recent = Object.entries(state.notified).some(
          ([k, t]) => k.startsWith(`${rule.id}:`) && now - t < cooldown,
        );
        if (recent) continue;
      }
      seen.add(key);
      out.push({ rule, message });
    }
  }
  return out;
}

/** 告警状态持久化（与消息索引分开存） */
export class AlertStore {
  file: string;

  constructor(root: string) {
    try {
      mkdirSync(root, { recursive: true });
      this.file = join(root, 'alerts.json');
    } catch {
      this.file = join(process.cwd(), '.qce-index', 'alerts.json');
      mkdirSync(join(process.cwd(), '.qce-index'), { recursive: true });
    }
  }

  load(): { rules: AlertRule[]; state: AlertState } {
    if (!existsSync(this.file)) return { rules: [], state: { notified: {} } };
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8'));
      return {
        rules: Array.isArray(parsed?.rules) ? parsed.rules : [],
        state: { notified: parsed?.state?.notified ?? {} },
      };
    } catch {
      return { rules: [], state: { notified: {} } };
    }
  }

  save(rules: AlertRule[], state: AlertState): void {
    // 只保留最近 5000 条已提醒记录，避免文件无限增长
    const entries = Object.entries(state.notified).sort((a, b) => b[1] - a[1]).slice(0, 5000);
    writeFileSync(this.file, JSON.stringify({ rules, state: { notified: Object.fromEntries(entries) } }, null, 2), 'utf8');
  }
}

/** 生成规则的稳定 id（内容相同即同一条） */
export function ruleId(rule: Pick<AlertRule, 'pattern' | 'groupId' | 'to' | 'regex'>): string {
  return `${rule.regex ? 're' : 'kw'}:${rule.groupId ?? '*'}:${rule.to}:${rule.pattern}`;
}
