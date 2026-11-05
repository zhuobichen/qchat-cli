import { Command } from 'commander';
import chalk from 'chalk';
import { authManager } from '../core/auth.js';
import { safetyManager } from '../core/safety.js';
import { MessageStore, defaultIndexRoot } from '../core/message-store.js';
import { fetchGroupMessages, parseDuration } from '../core/history.js';
import { AlertStore, pickHits, ruleId, type AlertRule } from '../core/alert.js';
import { resolveSession } from '../utils/resolveSession.js';

function stores() {
  const root = defaultIndexRoot();
  return { alerts: new AlertStore(root), messages: new MessageStore(root) };
}

export function alertCommand(program: Command): void {
  const alert = program
    .command('alert')
    .description('关键词告警：群消息命中规则时提醒到指定 QQ');

  alert
    .command('add <pattern>')
    .description('新增一条告警规则')
    .option('-t, --to <id>', '提醒发到哪个 QQ 号/群号', '')
    .option('-g, --group <id>', '只监听某个群')
    .option('--regex', '把 pattern 当正则')
    .option('--cooldown <seconds>', '同规则冷却秒数', '0')
    .action((pattern, options) => {
      if (!options.to) {
        console.log(chalk.red('必须指定 --to <QQ号或群号>'));
        return;
      }
      const { alerts } = stores();
      const { rules, state } = alerts.load();
      const groupId = options.group ? Number(options.group) : undefined;
      if (options.group && !Number.isFinite(groupId)) {
        console.log(chalk.red('--group 需要是群号'));
        return;
      }
      const rule: AlertRule = {
        id: '',
        pattern: String(pattern),
        regex: options.regex === true,
        ...(groupId !== undefined ? { groupId } : {}),
        to: String(options.to),
        cooldownSec: Number(options.cooldown) || 0,
        enabled: true,
      };
      rule.id = ruleId(rule);
      if (rules.some((r) => r.id === rule.id)) {
        console.log(chalk.yellow('这条规则已存在'));
        return;
      }
      rules.push(rule);
      alerts.save(rules, state);
      console.log(chalk.green(`已添加告警 ${rule.id}`));
    });

  alert
    .command('list')
    .description('列出告警规则')
    .action(() => {
      const { alerts } = stores();
      const { rules } = alerts.load();
      if (rules.length === 0) {
        console.log(chalk.yellow('还没有规则，先跑: qce alert add 关键词 --to <QQ号>'));
        return;
      }
      for (const r of rules) {
        const scope = r.groupId ? `群${r.groupId}` : '全部群';
        console.log(`${r.enabled === false ? chalk.dim('[停用] ') : ''}${r.id}`);
        console.log(chalk.dim(`  ${scope} → ${r.to}${r.cooldownSec ? `  冷却 ${r.cooldownSec}s` : ''}`));
      }
    });

  alert
    .command('remove <id>')
    .description('按 id 删除规则（也接受关键词）')
    .action((id) => {
      const { alerts } = stores();
      const { rules, state } = alerts.load();
      const next = rules.filter((r) => r.id !== id && r.pattern !== id);
      if (next.length === rules.length) {
        console.log(chalk.yellow('没找到这条规则'));
        return;
      }
      alerts.save(next, state);
      console.log(chalk.green(`已删除 ${rules.length - next.length} 条`));
    });

  alert
    .command('run')
    .description('执行一次检查（可配 cron / 定时任务常驻）')
    .option('--once', '只检查一次（默认）', true)
    .option('--offline', '不联网，只用本地索引')
    .option('--since <dur>', '只看最近一段时间，如 2h', '24h')
    .option('--dry', '只打印命中，不发送')
    .option('--limit <number>', '每个群最多扫描多少条', '500')
    .action(async (options) => {
      const { alerts, messages: store } = stores();
      const { rules, state } = alerts.load();
      if (rules.length === 0) {
        console.log(chalk.yellow('没有告警规则'));
        return;
      }

      const durationSec = parseDuration(options.since) ?? 86400;
      const cutoff = Math.floor(Date.now() / 1000) - durationSec;
      const limit = Number(options.limit) || 500;

      const targets = [...new Set(rules.map((r) => r.groupId).filter((g): g is number => typeof g === 'number'))];
      const groups = targets.length > 0 ? targets : store.stats().map((s) => s.groupId);

      if (!options.offline) {
        if (!authManager.isConfigured()) {
          console.log(chalk.yellow('未配置 NapCatQQ，只能离线检查'));
        } else {
          const client = authManager.getClient();
          for (const gid of groups) {
            try {
              const fresh = await fetchGroupMessages(client, gid, { limit, cutoff });
              store.merge(gid, fresh);
            } catch {
              // 单群失败不影响其它
            }
          }
        }
      }

      const all = groups.length > 0 ? groups.flatMap((g) => store.load(g)) : store.loadAll();
      const candidates = all.filter((m) => m.time >= cutoff);
      const hits = pickHits(rules, candidates, state, Math.floor(Date.now() / 1000));

      if (hits.length === 0) {
        console.log(chalk.dim(`检查 ${candidates.length} 条消息，无命中`));
        return;
      }

      console.log(chalk.cyan(`命中 ${hits.length} 条`));
      const client = authManager.isConfigured() ? authManager.getClient() : null;
      const now = Math.floor(Date.now() / 1000);

      for (const { rule, message } of hits) {
        const where = message.groupId ? `群${message.groupId}` : '私聊';
        console.log(`· [${rule.id}] ${where} ${message.senderName}: ${message.text.slice(0, 60)}`);

        if (options.dry) continue;          // 预演不写状态，否则真跑时就不会提醒了
        if (!client) {
          state.notified[`${rule.id}:${message.id}`] = now;
          continue;
        }

        const targetId = await resolveSession(rule.to);
        if (!safetyManager.isAllowed(targetId)) {
          console.log(chalk.yellow(`  跳过：${targetId} 未授权发送（qce safety allow ${targetId}）`));
          continue;
        }

        const text = `【告警】${rule.pattern}\n${where} ${message.senderName}:\n${message.text.slice(0, 200)}`;
        try {
          if (rule.to.startsWith('g')) await client.sendGroupMessage(targetId, text);
          else await client.sendPrivateMessage(targetId, text);
          state.notified[`${rule.id}:${message.id}`] = now;
          console.log(chalk.green('  已提醒'));
        } catch (error) {
          console.log(chalk.red(`  提醒失败: ${(error as Error).message}`));
        }
      }

      alerts.save(rules, state);
    });
}
