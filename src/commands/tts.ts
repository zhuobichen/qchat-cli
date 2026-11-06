import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync } from 'node:fs';
import { authManager } from '../core/auth.js';
import { safetyManager } from '../core/safety.js';
import { synthesize, downloadAudio, toVoiceFormat, findFfmpeg, synthesizeLocal, saveAudioBuf } from '../core/tts.js';
import { resolveSession } from '../utils/resolveSession.js';

export function ttsCommand(program: Command): void {
  program
    .command('tts <text>')
    .description('把文字合成语音（阿里云百炼 Qwen-TTS），可直接发成 QQ 语音条')
    .option('-o, --output <dir>', '音频保存目录', './output')
    .option('--voice <name>', '音色', 'Cherry')
    .option('--model <name>', '模型', 'qwen3-tts-flash')
    .option('--provider <p>', 'cloud（默认，Qwen-TTS）或 local（本地克隆音色）', 'cloud')
    .option('--endpoint <url>', 'local provider 的服务地址，如 http://127.0.0.1:9880')
    .option('--ref-audio <path>', 'local：参考音频（克隆音色用）')
    .option('--prompt-text <text>', 'local：参考音频对应的文字')
    .option('--send-to <id>', '合成后直接发到这个 QQ/群号')
    .option('--kind <k>', 'private（默认）或 group', 'private')
    .option('--force', '跳过安全确认')
    .action(async (text, options) => {
      console.log(chalk.dim('合成中...'));
      let file = '';

      if (String(options.provider || 'cloud').toLowerCase() === 'local') {
        if (!options.endpoint) {
          console.log(chalk.red('local provider 需要 --endpoint，例如 http://127.0.0.1:9880'));
          return;
        }
        let buf: Buffer | null = null;
        try {
          buf = await synthesizeLocal(String(text), {
            endpoint: String(options.endpoint),
            ...(options.refAudio ? { refAudio: String(options.refAudio) } : {}),
            ...(options.promptText ? { promptText: String(options.promptText) } : {}),
          });
        } catch (error) {
          // 路径写错、合成静音都会走到这里——不要吞成"检查服务是否在跑"
          console.log(chalk.red(`本地合成失败: ${(error as Error).message}`));
          return;
        }
        if (!buf) {
          console.log(chalk.red('本地合成失败：检查服务是否在跑（GPT-SoVITS api_v2 的 /tts）'));
          console.log(chalk.dim(`  端点: ${options.endpoint}`));
          console.log(chalk.dim('  参考音频建议传**绝对路径**，相对路径按当前目录解析'));
          return;
        }
        file = saveAudioBuf(buf, options.output);
        console.log(chalk.green('已合成（本地音色）'));
        console.log(`  音频: ${file}`);
      } else {
        const result = await synthesize(String(text), {
          voice: options.voice,
          model: options.model,
        });
        if (!result) {
          console.log(chalk.red('合成失败：检查 DASHSCOPE_API_KEY 与模型名（qwen3-tts-flash）'));
          return;
        }
        file = await downloadAudio(result.url, options.output);
        console.log(chalk.green('已合成'));
        console.log(`  音频: ${file}`);
        console.log(chalk.dim(`  远端地址 24 小时内有效：${result.url.slice(0, 80)}…`));
      }

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
