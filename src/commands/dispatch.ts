/**
 * qce dispatch —— 派活的工具层入口。
 *
 * 为什么只做一层薄壳：真正跟 DSH supervisor 打交道的逻辑（createSession / send /
 * workspaceId 匹配 / 守望回报）已经在 `scripts/dispatch.mjs` 里跑通并踩完了坑，
 * 在这儿重写一遍等于留两份会各自漂移的实现。所以这里只干一件事：
 * 把参数原样转过去，stdout/stderr 直接继承（进度、错误、交互都照常看见）。
 *
 * 子命令由 dispatch.mjs 自己解析：lanes / new / list / tail / say / status / watch / reset-lane。
 */
import { Command } from 'commander';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function dispatchCommand(program: Command): void {
  program
    .command('dispatch [args...]')
    .description(
      '派活：把写代码/分析这类活丢给独立会话。子命令 lanes/new/list/tail/say/status/watch/reset-lane',
    )
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    // 这里刻意不声明任何 option：--lane/--title/--notify 都由 dispatch.mjs 解析，
    // commander 多声明一份就会出现"看着传了、其实被吃掉"的情况。
    .action((args: string[]) => {
      const script = join(ROOT, 'scripts', 'dispatch.mjs');
      const r = spawnSync(process.execPath, [script, ...(args ?? [])], {
        stdio: 'inherit',
        cwd: process.cwd(),
      });
      process.exitCode = r.status ?? 1;
    });
}
