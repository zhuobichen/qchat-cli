import { Command } from 'commander';
import chalk from 'chalk';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { authManager } from '../core/auth.js';
import { safetyManager } from '../core/safety.js';
import { defaultIndexRoot } from '../core/message-store.js';
import { MemoryStore, recallMemories } from '../core/memory.js';
import {
  decideProactive, afterSend, DEFAULT_PROACTIVE, type ProactiveConfig, type ProactiveState,
} from '../core/proactive.js';
import { resolveSession } from '../utils/resolveSession.js';

function statePath(): string {
  const root = defaultIndexRoot();
  mkdirSync(root, { recursive: true });
  return join(root, 'proactive.json');
}

function loadState(): { state: Record<string, ProactiveState>; config: ProactiveConfig } {
  try {
    const raw = JSON.parse(readFileSync(statePath(), 'utf8'));
    return { state: raw.state ?? {}, config: { ...DEFAULT_PROACTIVE, ...(raw.config ?? {}) } };
  } catch {
    return { state: {}, config: DEFAULT_PROACTIVE };
  }
}

function saveState(data: { state: Record<string, ProactiveState>; config: ProactiveConfig }): void {
  writeFileSync(statePath(), JSON.stringify(data, null, 2), 'utf8');
}

export function proactiveCommand(program: Command): void {
  const cmd = program
    .command('proactive')
    .description('主动聊天：免打扰 / 最小间隔 / 每日上限 / 概率触发');

  cmd
    .command('run')
    .description('跑一次决策（满足条件才发）')
    .option('-t, --to <id>', '发给谁：QQ 号或群号')
    .option('--kind <k>', 'private（默认）或 group', 'private')
    .option('--text <text>', '要发的内容；不给就用最重的长期记忆当话题')
    .option('--dry', '只输出决策，不发送')
    .option('--force', '忽略安全确认')
    .action(async (options) => {
      if (!options.to) {
        console.log(chalk.red('需要 --to <QQ号或群号>'));
        return;
      }
      const key = String(options.to);
      const { state, config } = loadState();
      const now = Math.floor(Date.now() / 1000);
      const decision = decideProactive(now, state[key] ?? { sentToday: 0 }, config);
      console.log(decision.send ? chalk.green(`决定主动：${decision.reason}`) : chalk.yellow(`不主动：${decision.reason}`));

      if (options.dry || !decision.send) return;

      // 内容：显式文本 > 最重的记忆 > 放弃
      let text = typeof options.text === 'string' ? options.text.trim() : '';
      if (text === '') {
        const memStore = new MemoryStore(defaultIndexRoot());
        const top = recallMemories(memStore.load(), { scope: key, limit: 1 });
        if (top.length > 0) text = `突然想起你之前说过：${top[0].text}`;
      }
      if (text === '') {
        console.log(chalk.yellow('没有可用话题（给 --text，或先用 qce memory add 记点东西）'));
        return;
      }

      if (!authManager.isConfigured()) {
        console.log(chalk.yellow(`（未配置 NapCatQQ）本来要发：${text}`));
        return;
      }
      const target = await resolveSession(key);
      if (!safetyManager.isAllowed(target)) {
        console.log(chalk.red(`会话 ${target} 未授权发送（先跑 qce safety allow ${target}）`));
        return;
      }

      const kind = String(options.kind || 'private').toLowerCase() === 'group' ? 'group' : 'private';
      try {
        const client = authManager.getClient();
        if (kind === 'group') await client.sendGroupMessage(target, text);
        else await client.sendPrivateMessage(target, text);
        saveState({ state: { ...state, [key]: afterSend(now, state[key] ?? { sentToday: 0 }) }, config });
        console.log(chalk.green(`已主动发出：${text}`));
      } catch (error) {
        console.log(chalk.red(`发送失败: ${(error as Error).message}`));
      }
    });

  cmd
    .command('config')
    .description('查看/修改主动聊天参数')
    .option('--quiet <start-end>', '免打扰时段，如 23-8')
    .option('--gap <minutes>', '最小间隔分钟')
    .option('--max <n>', '每日上限')
    .option('--probability <p>', '触发概率 0-1')
    .option('--idle <minutes>', '多久没聊才算冷场')
    .action((options) => {
      const data = loadState();
      if (options.quiet) {
        const m = String(options.quiet).match(/^(\d{1,2})-(\d{1,2})$/);
        if (!m) { console.log(chalk.red('--quiet 形如 23-8')); return; }
        data.config.quietStartHour = Number(m[1]);
        data.config.quietEndHour = Number(m[2]);
      }
      if (options.gap) data.config.minGapMinutes = Number(options.gap);
      if (options.max) data.config.maxPerDay = Number(options.max);
      if (options.probability) data.config.probability = Math.min(1, Math.max(0, Number(options.probability)));
      if (options.idle) data.config.idleMinutes = Number(options.idle);
      saveState(data);
      console.log(chalk.cyan('当前配置：'));
      console.log(JSON.stringify(data.config, null, 2));
    });
}
