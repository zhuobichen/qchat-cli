/**
 * `qce persona`：人格的查看与切换。
 *
 *   qce persona show [scope]          看当前生效的人格（哪个来源）
 *   qce persona mode [global|per-scope]  查/切模式
 *   qce persona set [scope] <file>    写入人格（不带 scope = 全局）
 *   qce persona list                  列出所有已有人格文件
 */
import { Command } from 'commander';
import chalk from 'chalk';
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_PERSONA_DIR,
  GLOBAL_PERSONA_NAME,
  loadPersonaMode,
  savePersonaMode,
  resolvePersona,
  saveGroupPersona,
  saveGlobalPersona,
  type PersonaMode,
} from '../core/persona.js';

const persona = new Command('persona')
  .description('人格：查看 / 切换全局或按群模式')
  .addCommand(
    new Command('show')
      .description('看当前生效的人格（含来源说明）')
      .argument('[scope]', '群号或 QQ 号（省略则只看全局）')
      .action((scope) => {
        const mode = loadPersonaMode();
        console.log(chalk.cyan(`模式: ${mode === 'global' ? 'global（全局，所有场合共用一份）' : 'per-scope（按群/按人，没写的落到全局）'}`));
        console.log('');

        const r = resolvePersona(scope ?? GLOBAL_PERSONA_NAME);
        // 标签别再写死 global.md：默认人格 2026-11-13 已换成 friendly-ai.md，
        // 写死会让 show 输出骗人（文件明明读的是 friendly-ai，标签却显示 global.md）。
        const sourceLabel =
          r.source === 'global' ? `全局 ${GLOBAL_PERSONA_NAME}.md`
            : r.source === 'scope' ? `专属 ${scope}.md`
              : '(没有人格)';

        if (!r.text) {
          console.log(chalk.yellow(`当前没有人格生效（来源: ${sourceLabel}）`));
          console.log(chalk.dim(`写一份：qce persona set <文件路径>`));
          return;
        }
        console.log(chalk.dim(`来源: ${sourceLabel}（${r.text.length} 字）`));
        console.log('');
        console.log(r.text);
      }),
  )
  .addCommand(
    new Command('mode')
      .description('查看或切换人格模式')
      .argument('[mode]', 'global 或 per-scope')
      .action((mode) => {
        if (!mode) {
          const cur = loadPersonaMode();
          console.log(`当前模式: ${chalk.cyan(cur)}`);
          console.log('');
          console.log(chalk.dim('  global    —— 全局：所有群和私聊共用 private/personas/global.md'));
          console.log(chalk.dim('  per-scope —— 按范围：先用 <群号>.md，没有再用 global.md'));
          return;
        }
        if (mode !== 'global' && mode !== 'per-scope') {
          console.log(chalk.red(`模式只能是 global 或 per-scope，收到: ${mode}`));
          return;
        }
        const file = savePersonaMode(mode as PersonaMode);
        console.log(chalk.green(`已切换到 ${mode}`));
        console.log(chalk.dim(`写入: ${file}`));
        if (mode === 'global') {
          console.log('');
          console.log(chalk.yellow('注意：global 模式下按群的人格文件会被忽略。'));
          console.log(chalk.dim('  如果 global.md 还不存在，现在等于"没有人格"。'));
          if (!existsSync(join(DEFAULT_PERSONA_DIR, `${GLOBAL_PERSONA_NAME}.md`))) {
            console.log(chalk.yellow('  建议先写一份：qce persona set <文件路径>'));
          }
        }
      }),
  )
  .addCommand(
    new Command('set')
      .description('写入人格（不带 scope = 写全局）')
      .argument('<source>', '人格文件路径，或 - 表示从 stdin 读')
      .option('-s, --scope <scope>', '群号或 QQ 号（省略则写全局）')
      .action((source, options) => {
        let text: string;
        try {
          text = source === '-' ? readFileSync(0, 'utf8') : readFileSync(source, 'utf8');
        } catch (error) {
          console.log(chalk.red(`读不到 ${source}: ${(error as Error).message}`));
          return;
        }
        if (!text.trim()) {
          console.log(chalk.red('人格文件是空的'));
          return;
        }
        const file = options.scope ? saveGroupPersona(String(options.scope), text) : saveGlobalPersona(text);
        console.log(chalk.green(`已写入 ${file}`));
        console.log(chalk.dim(`模式: ${loadPersonaMode()}`));
      }),
  )
  .addCommand(
    new Command('list')
      .description('列出所有已有人格文件')
      .action(() => {
        const mode = loadPersonaMode();
        console.log(chalk.cyan(`模式: ${mode}`));
        console.log('');
        if (!existsSync(DEFAULT_PERSONA_DIR)) {
          console.log(chalk.dim(`目录不存在: ${DEFAULT_PERSONA_DIR}`));
          return;
        }
        const files = readdirSync(DEFAULT_PERSONA_DIR).filter((f) => f.endsWith('.md'));
        if (files.length === 0) {
          console.log(chalk.dim('还没有任何人格文件'));
          return;
        }
        for (const f of files) {
          const isGlobal = f === `${GLOBAL_PERSONA_NAME}.md`;
          const size = readFileSync(join(DEFAULT_PERSONA_DIR, f), 'utf8').length;
          // global 模式下按群文件不生效，标出来免得以为改了没反应
          const inactive = mode === 'global' && !isGlobal;
          const tag = isGlobal ? chalk.green('[全局]') : inactive ? chalk.dim('[当前不生效]') : chalk.cyan('[按范围]');
          console.log(`  ${tag} ${f}  ${size} 字`);
        }
      }),
  );

/** 供 cli.ts 挂载（与其它命令的写法保持一致：传 program 进来） */
export function personaCommand(program: Command): void {
  program.addCommand(persona);
}
