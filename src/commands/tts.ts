import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync } from 'node:fs';
import { authManager } from '../core/auth.js';
import { safetyManager } from '../core/safety.js';
import { synthesize, downloadAudio, toVoiceFormat, findFfmpeg } from '../core/tts.js';
import { resolveSession } from '../utils/resolveSession.js';

export function ttsCommand(program: Command): void {
  program
    .command('tts <text>')
    .description('把文字合成语音（阿里云百炼 Qwen-TTS），可直接发成 QQ 语音条')
    .option('-o, --output <dir>', '音频保存目录', './output')
    .option('--voice <name>', '音色', 'Cherry')
    .option('--model <name>', '模型', 'qwen3-tts-flash')
    .option('--send-to <id>', '合成后直接发到这个 QQ/群号')
    .option('--kind <k>', 'private（默认）或 group', 'private')
    .option('--force', '跳过安全确认')
    .action(async (text, options) => {
      console.log(chalk.dim('合成中...'));
      const result = await synthesize(String(text), {
        voice: options.voice,
        model: options.model,
      });
      if (!result) {
        console.log(chalk.red('合成失败：检查 DASHSCOPE_API_KEY 与模型名（qwen3-tts-flash）'));
        return;
      }

      const file = await downloadAudio(result.url, options.output);
      console.log(chalk.green('已合成'));
      console.log(`  音频: ${file}`);
      console.log(chalk.dim(`  远端地址 24 小时内有效：${result.url.slice(0, 80)}…`));

      if (!options.sendTo) return;

      if (!authManager.isConfigured()) {
        console.log(chalk.yellow('未配置 NapCatQQ，只生成了文件'));
        return;
      }
      const target = await resolveSession(String(options.sendTo));
      if (!safetyManager.isAllowed(target)) {
        console.log(chalk.red(`会话 ${target} 未授权发送（先跑 qce safety allow ${target}）`));
        return;
      }

      const kind = String(options.kind || 'private').toLowerCase() === 'group' ? 'group' : 'private';
      // QQ 语音条不吃 wav：先转 AMR（找不到 ffmpeg 就退回原文件）
      const ffmpeg = findFfmpeg();
      const voice = toVoiceFormat(file, ffmpeg, options.output);
      if (voice.format === 'wav') console.log(chalk.yellow('没找到 ffmpeg，直接发 wav（NapCat 可能拒收）'));
      else console.log(chalk.dim(`  已转 ${voice.format.toUpperCase()}: ${voice.file}`));

      const client = authManager.getClient();
      // NapCat 对 file:// 的语音转码会失败，base64:// 实测可用
      const b64 = readFileSync(voice.file).toString('base64');
      const message = [{ type: 'record', data: { file: `base64://${b64}` } }] as any;
      try {
        if (kind === 'group') await client.sendGroupMessage(target, message);
        else await client.sendPrivateMessage(target, message);
        console.log(chalk.green(`语音已发到 ${kind === 'group' ? '群' : 'QQ'} ${target}`));
      } catch (error) {
        console.log(chalk.red(`发送失败: ${(error as Error).message}`));
      }
    });
}
