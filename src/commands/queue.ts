import { Command } from 'commander';
import chalk from 'chalk';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const SCRIPT = join(process.cwd(), 'scripts', 'qce-queue.mjs');

function runQueue(args: string[]): { code: number; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** 把队列条目渲染成人类/模型都看得懂的格式 */
export function renderQueueItem(item: any): string {
  const p = item.payload ?? {};
  const lines: string[] = [];
  const where = p.kind === 'group' ? `群 ${p.peerName ?? p.peer}` : `私聊 ${p.sender ?? p.peer}`;
  lines.push(`[${where}] ${p.sender ?? ''}（${p.senderId ?? '?'}）`);
  lines.push(`内容：${p.text ?? ''}`);
  if (p.mentioned) lines.push('（@ 了我）');
  if (Array.isArray(p.context) && p.context.length) {
    lines.push('最近上下文：');
    for (const c of p.context.slice(-5)) lines.push(`  ${c.sender}: ${c.text}`);
  }
  if (p.replyHint) lines.push(`提示：${p.replyHint}`);
  lines.push(`队列 id：${item.id}`);
  return lines.join('\n');
}

export function queueCommand(program: Command): void {
  const q = program
    .command('queue')
    .description('待回复队列：QQ 消息入队 → 会话里的我处理 → 出队');

  q.command('list')
    .description('看队列状态与条目')
    .option('--full', '展开完整内容', false)
    .action((options) => {
      const r = runQueue(['list']);
      try {
        const data = JSON.parse(r.stdout);
        console.log(chalk.cyan(`共 ${data.total} 条，待处理 ${data.pending}，处理中 ${data.processing}，已跳过 ${data.skipped}`));
        for (const item of data.items ?? []) {
          if (options.full) {
            console.log(chalk.dim('─'.repeat(40)));
            console.log(renderQueueItem(item));
          } else {
            const p = item.payload ?? {};
            console.log(`  ${item.id}  ${item.status}  ${p.kind ?? '?'} ${p.peer ?? ''}${p.mentioned ? ' @我' : ''}  ${String(p.text ?? '').slice(0, 40)}`);
          }
        }
      } catch {
        console.log(r.stdout || r.stderr);
      }
    });

  q.command('take')
    .description('取一条待处理（标记 processing），并展开内容')
    .option('--json', '输出 JSON', false)
    .action((options) => {
      const r = runQueue(['take']);
      try {
        const data = JSON.parse(r.stdout);
        if (data.empty) {
          console.log(chalk.green('队列是空的'));
          return;
        }
        if (options.json) console.log(JSON.stringify(data, null, 2));
        else console.log(renderQueueItem(data));
      } catch {
        console.log(r.stdout || r.stderr);
      }
    });

  q.command('done <id>')
    .description('处理完，删除该条')
    .action((id) => {
      console.log(runQueue(['done', id]).stdout.trim() === 'ok' ? chalk.green('已出队') : chalk.red('出队失败'));
    });

  q.command('skip <id> [reason]')
    .description('跳过这条（不该回）')
    .action((id, reason) => {
      console.log(runQueue(['skip', id, reason ?? '']).stdout.trim() === 'ok' ? chalk.green('已跳过') : chalk.red('跳过失败'));
    });

  q.command('reclaim [seconds]')
    .description('把超时的 processing 重新入队（我崩了/断线了）')
    .option('--older-than <s>', '超时秒数', '300')
    .action((seconds, options) => {
      const r = runQueue(['reclaim', String(options.olderThan ?? seconds ?? 300)]);
      console.log(r.stdout.trim());
    });
}
