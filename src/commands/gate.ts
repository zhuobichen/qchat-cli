import { Command } from 'commander';
import chalk from 'chalk';
import { gateReply, type GateContext } from '../core/reply-gate.js';

export function gateCommand(program: Command): void {
  program
    .command('gate <text>')
    .description('判断一条消息要不要回（Jev 决策 + 规则回落）')
    .option('-t, --trigger <t>', 'mention（@我）| private（私聊）| ambient（路人闲聊）', 'ambient')
    .option('-n, --recent <n>', '额外带几条上下文（用 ; 分隔）', '')
    .option('--json', '输出 JSON')
    .action(async (text, options) => {
      const trigger = String(options.trigger || 'ambient') as GateContext['trigger'];
      const recent = String(options.recent || '')
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean);
      recent.push(String(text));

      const result = await gateReply({ trigger, recent });
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      const icon = result.decision === 'reply' ? '✅' : result.decision === 'wait' ? '⏳' : '🙈';
      console.log(`${icon} ${result.decision}  (来源 ${result.source}, 置信度 ${result.confidence.toFixed(2)})`);
      if (result.reason) console.log(chalk.dim(`   ${result.reason}`));
    });
}
