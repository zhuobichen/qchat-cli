import { Command } from 'commander';
import chalk from 'chalk';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { searchMemes } from '../core/memesource.js';
import { authManager } from '../core/auth.js';
import { safetyManager } from '../core/safety.js';
import { resolveSession } from '../utils/resolveSession.js';

export function memeCommand(program: Command): void {
  program
    .command('meme <query>')
    .description('从 memecub 搜表情（英文索引为主），可下载或直接发出去')
    .option('-n, --limit <n>', '返回条数', '5')
    .option('--pick <n>', '选第几个（从 1 开始）', '1')
    .option('--send-to <id>', '直接发到这个 QQ/群号')
    .option('--kind <k>', 'private（默认）或 group', 'private')
    .option('--json', '输出 JSON')
    .action(async (query, options) => {
      const results = await searchMemes(String(query), { limit: Number(options.limit) || 5 });
      if (results.length === 0) {
        console.log(chalk.yellow(`没有结果：${query}`));
        if (/[\u4e00-\u9fff]/.test(String(query))) {
          console.log(chalk.dim('memecub 的索引以英文为主（facepalm / cat 有结果，中文多半为 0），换个英文词试试。'));
        }
        return;
      }

      if (options.json) {
        console.log(JSON.stringify(results, null, 2));
        return;
      }

      console.log(chalk.cyan(`共 ${results.length} 条：`));
      results.forEach((r, i) => {
        const tag = r.commercialUse === true ? chalk.green('商用OK') : chalk.dim('仅自用');
        console.log(`  ${i + 1}. [${tag}] ${r.title || '(无标题)'}`);
        console.log(chalk.dim(`     ${r.url}`));
      });

      if (!options.sendTo) return;

      const idx = Math.max(1, Number(options.pick) || 1) - 1;
      const chosen = results[idx];
      if (!chosen) {
        console.log(chalk.red(`--pick 越界（只有 ${results.length} 条）`));
        return;
      }
      if (!authManager.isConfigured()) {
        console.log(chalk.yellow('未配置 NapCatQQ，只列出结果'));
        return;
      }
      const target = await resolveSession(String(options.sendTo));
      if (!safetyManager.isAllowed(target)) {
        console.log(chalk.red(`会话 ${target} 未授权发送（qce safety allow ${target}）`));
        return;
      }

      // 下载图片（按 content-type 定扩展名，别用音频下载器）
      mkdirSync('./output', { recursive: true });
      const res = await fetch(chosen.url);
      if (!res.ok) {
        console.log(chalk.red(`下载图片失败 HTTP ${res.status}`));
        return;
      }
      const ctype = String(res.headers.get('content-type') ?? '');
      const ext = ctype.includes('png') ? 'png' : ctype.includes('gif') ? 'gif' : ctype.includes('webp') ? 'webp' : 'jpg';
      const file = join('./output', `meme-${Date.now()}.${ext}`);
      writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      const b64 = readFileSync(file).toString('base64');
      const kind = String(options.kind || 'private').toLowerCase() === 'group' ? 'group' : 'private';
      const message = [{ type: 'image', data: { file: `base64://${b64}` } }] as any;
      try {
        const client = authManager.getClient();
        if (kind === 'group') await client.sendGroupMessage(target, message);
        else await client.sendPrivateMessage(target, message);
        console.log(chalk.green(`已发送「${chosen.title || chosen.url}」到 ${kind === 'group' ? '群' : 'QQ'} ${target}`));
      } catch (error) {
        console.log(chalk.red(`发送失败: ${(error as Error).message}`));
      }
    });
}
