import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { authManager } from '../core/auth.js';
import { DEFAULT_INTERVAL_MS, describeDirectory, importFaces, LEDGER_PATH } from '../core/face-import.js';

const divider = () => chalk.dim('─'.repeat(50));

/**
 * 把「连不上 NapCat」翻成人话。
 *
 * 不翻译的话，用户看到的是一坨 `TypeError: fetch failed` + 三次重试 WARN 的堆栈，
 * 完全不知道下一步该干嘛——而这恰恰是最常见的一种失败（NapCat 没启动）。
 */
function explain(error: unknown): string {
  const text = String((error as Error)?.message ?? error);
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|socket hang up/i.test(text)) {
    return '连不上 NapCat。先确认它在跑、并且已扫码登录（qce napcat status 可以查）。';
  }
  return text;
}

export function faceCommand(program: Command): void {
  const face = program.command('face').description('QQ 收藏表情（自定义表情）');

  // ---------------------------------------------------------------- list
  face
    .command('list')
    .description('列出当前 QQ 收藏的表情')
    .option('--count <number>', '取多少条', '50')
    .action(async (options) => {
      if (!authManager.isConfigured()) {
        console.log(chalk.red('请先配置 NapCatQQ 连接'));
        console.log(chalk.dim('运行: qce login --host <host> --port <port>'));
        return;
      }
      try {
        const list = await authManager.getClient().fetchCustomFaceDetail(Number(options.count));
        if (!Array.isArray(list) || list.length === 0) {
          console.log(chalk.yellow('收藏表情是空的（或接口返回了空数组）'));
          return;
        }
        console.log(chalk.bold(`\n收藏表情 ${list.length} 条\n`));
        list.forEach((item, index) => {
          // 字段名未定型，这里只能尽量把能认出来的打出来
          const rec = item as Record<string, unknown>;
          const label = rec.md5 ?? rec.emojiId ?? rec.resId ?? Object.values(rec)[0] ?? '?';
          console.log(`  ${String(index + 1).padStart(3)}. ${String(label).slice(0, 48)}`);
        });
        console.log('');
        console.log(
          chalk.dim('如果显示的内容不像表情（比如全是 undefined），说明 fetch_custom_face_detail 的') +
            chalk.dim('\n返回结构和预期不同——把原始 JSON 打出来看看，再去修 face-import.ts 里的查重键。')
        );
      } catch (error) {
        console.log(chalk.red('获取收藏表情失败:'), explain(error));
      }
    });

  // ---------------------------------------------------------------- import
  face
    .command('import <dir>')
    .description('把目录里的图片批量导入 QQ 收藏表情（串行 + 限速，可中断续跑）')
    .option('--interval <ms>', '每张之间的间隔（毫秒）', String(DEFAULT_INTERVAL_MS))
    .option('--limit <number>', '最多导多少张（先拿 2~3 张试跑用）')
    .option('--force', '跳过确认')
    .option('--no-check', '不查 QQ 现有收藏（跳过查重，快一点但可能重复）')
    .action(async (dir: string, options) => {
      if (!authManager.isConfigured()) {
        console.log(chalk.red('请先配置 NapCatQQ 连接'));
        console.log(chalk.dim('运行: qce login --host <host> --port <port>'));
        return;
      }

      const probe = describeDirectory(dir);
      if (!probe.ok) {
        console.log(chalk.red(probe.message));
        return;
      }

      const intervalMs = Math.max(Number(options.interval) || DEFAULT_INTERVAL_MS, 0);
      const limit = options.limit ? Number(options.limit) : undefined;
      const count = limit ? Math.min(limit, probe.count) : probe.count;
      const estimateSec = Math.round((count * intervalMs) / 1000);

      console.log('');
      console.log(chalk.bold('计划导入'));
      console.log(`  目录    ${dir}`);
      console.log(`  可用    ${probe.message}`);
      console.log(`  本次导  ${count} 张${limit ? chalk.dim('（被 --limit 限制）') : ''}`);
      console.log(`  节奏    ${intervalMs} ms/张，约 ${estimateSec} 秒`);
      console.log(`  账本    ${chalk.dim(LEDGER_PATH)}`);
      console.log('');

      // 非交互环境（脚本/管道）里 inquirer 会崩——项目里已经踩过这个坑（QUESTION.md Q5）。
      // 所以这里不硬上，直接要求显式 --force。
      if (!options.force && !process.stdin.isTTY) {
        console.log(chalk.red('当前不是交互终端，无法弹确认框。'));
        console.log(chalk.dim('确认无误后加 --force 重跑。'));
        return;
      }

      if (!options.force) {
        console.log(
          chalk.yellow('⚠ 这会往你的 QQ 账号收藏夹里写东西') +
            chalk.dim('\n  短时间大量添加可能触发风控。中途可 Ctrl-C，重跑会跳过已成功的。')
        );
        const { confirm } = await inquirer.prompt([
          { type: 'confirm', name: 'confirm', message: `确认导入 ${count} 张？`, default: false },
        ]);
        if (!confirm) {
          console.log(chalk.yellow('已取消'));
          return;
        }
      }

      try {
        const result = await importFaces(authManager.getClient(), dir, {
          intervalMs,
          limit,
          checkExisting: options.check !== false,
          onProgress: (text) => console.log('  ' + text),
        });

        console.log('');
        console.log(divider());
        console.log(
          `导入完成: ${chalk.green(String(result.added))} 成功, ` +
            `${chalk.dim(String(result.skipped))} 跳过, ` +
            `${result.failed.length ? chalk.red(String(result.failed.length)) : '0'} 失败`
        );
        if (result.failed.length) {
          console.log('');
          console.log(chalk.red('失败清单:'));
          for (const item of result.failed) {
            console.log(`  ${chalk.red('✗')} ${item.file}  ${chalk.dim(item.error.slice(0, 100))}`);
          }
          console.log(chalk.dim('\n失败的不影响已成功的；重跑会只补这些。'));
        }
        if (result.abortedByRateLimit) {
          console.log('');
          console.log(chalk.red('因限流中止。等 15-30 分钟再跑同一个命令即可续上。'));
        }
        console.log(divider());
      } catch (error) {
        console.log(chalk.red('导入失败:'), explain(error));
      }
    });
}
