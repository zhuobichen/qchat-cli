import { Command } from 'commander';
import chalk from 'chalk';
import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { runAsr } from '../core/asr.js';

export function asrCommand(program: Command): void {
  program
    .command('asr <files...>')
    .description('把本地音频转成文字（离线 faster-whisper，需本地已缓存模型）')
    .option('--model <name>', '模型名（默认 small，需已缓存）')
    .option('--json', '输出 JSON')
    .action((files: string[], options) => {
      const existing = files.filter((f) => existsSync(f));
      if (existing.length === 0) {
        console.log(chalk.red('没有可读的音频文件'));
        return;
      }
      console.log(chalk.dim(`转写 ${existing.length} 个文件（首次加载模型可能慢）...`));

      const results = runAsr(existing, { model: options.model });
      if (results.length === 0) {
        console.log(chalk.red('转写失败：检查 faster-whisper 与本地模型缓存（QCE_ASR_MODEL 可指定模型）'));
        return;
      }

      if (options.json) {
        console.log(JSON.stringify(results, null, 2));
        return;
      }

      for (const r of results) {
        const name = basename(r.file);
        if (r.error) {
          console.log(chalk.red(`${name}: ${r.error}`));
          continue;
        }
        const meta = [r.language, r.duration ? `${r.duration}s` : ''].filter(Boolean).join(' · ');
        console.log(chalk.cyan(`${name}${meta ? `（${meta}）` : ''}`));
        console.log(r.text.trim() ? `  ${r.text.trim()}` : chalk.dim('  （没有识别到语音）'));
      }
    });
}
