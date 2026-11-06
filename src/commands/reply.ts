import { Command } from 'commander';
import chalk from 'chalk';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { authManager } from '../core/auth.js';
import { safetyManager } from '../core/safety.js';
import { resolveSession } from '../utils/resolveSession.js';
import { decideMedium } from '../core/reply-medium.js';
import { synthesize, downloadAudio, toVoiceFormat, findFfmpeg, synthesizeLocal, saveAudioBuf } from '../core/tts.js';
import { withResilience, CircuitBreaker, DeadLetterQueue } from '../core/reliability.js';

const breaker = new CircuitBreaker(5, 60_000);

function dlqDir(): string {
  const dir = process.env.QCE_INDEX_DIR ?? join(process.cwd(), '.qce-index');
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** 语音合成（云端或本地克隆） */
async function makeVoice(text: string, options: any, outDir: string): Promise<string | null> {
  if (String(options.provider ?? 'cloud').toLowerCase() === 'local') {
    if (!options.endpoint) return null;
    const buf = await synthesizeLocal(text, {
      endpoint: String(options.endpoint),
      ...(options.refAudio ? { refAudio: String(options.refAudio) } : {}),
      ...(options.promptText ? { promptText: String(options.promptText) } : {}),
    });
    if (!buf) return null;
    return saveAudioBuf(buf, outDir);
  }
  const result = await synthesize(text, {
    ...(options.voice ? { voice: String(options.voice) } : {}),
    ...(options.model ? { model: String(options.model) } : {}),
  });
  if (!result) return null;
  return downloadAudio(result.url, outDir);
}

export function replyCommand(program: Command): void {
  program
    .command('reply <text>')
    .description('自动决定发文字还是语音（规则 + Jev），并发送；失败自动重试/熔断/进死信')
    .option('-t, --to <id>', '发给谁：QQ 号或群号')
    .option('--kind <k>', 'private（默认）或 group', 'private')
    .option('--incoming-voice', '对方发的是语音（则回语音）')
    .option('--incoming-text <text>', '对方说的内容（用于判断）')
    .option('--force-text', '强制发文字')
    .option('--force-voice', '强制发语音')
    .option('--provider <p>', '语音来源：cloud 或 local', 'cloud')
    .option('--endpoint <url>', 'local provider 地址')
    .option('--ref-audio <path>', 'local：参考音频')
    .option('--prompt-text <text>', 'local：参考音频对应文本')
    .option('-o, --output <dir>', '音频目录', './output')
    .option('--dry', '只决策不发送')
    .option('--json', '输出 JSON')
    .action(async (text, options) => {
      const reply = String(text);

      // 1) 决定文字还是语音
      let decision;
      if (options.forceText) {
        decision = { medium: 'text' as const, reason: '强制文字', source: 'rules' as const, confidence: 1 };
      } else if (options.forceVoice) {
        decision = { medium: 'voice' as const, reason: '强制语音', source: 'rules' as const, confidence: 1 };
      } else {
        decision = await decideMedium({
          reply,
          ...(options.incomingText ? { incomingText: String(options.incomingText) } : {}),
          ...(options.incomingVoice ? { incomingIsVoice: true } : {}),
        });
      }

      if (options.json) {
        console.log(JSON.stringify({ decision }, null, 2));
        if (options.dry) return;
      } else {
        const icon = decision.medium === 'voice' ? '🔊' : '💬';
        console.log(`${icon} ${decision.medium}（${decision.source}）— ${decision.reason}`);
        if (options.dry) return;
      }

      if (!options.to) {
        console.log(chalk.yellow('没有 --to，只决策不发送'));
        return;
      }
      if (!authManager.isConfigured()) {
        console.log(chalk.yellow('未配置 NapCatQQ，不发送'));
        return;
      }
      const target = await resolveSession(String(options.to));
      if (!safetyManager.isAllowed(target)) {
        console.log(chalk.red(`会话 ${target} 未授权发送（qce safety allow ${target}）`));
        return;
      }

      // 2) 组装消息
      let message: any;
      if (decision.medium === 'voice') {
        const audio = await makeVoice(reply, options, options.output);
        if (!audio) {
          console.log(chalk.yellow('语音合成失败，改发文字'));
          message = reply;
        } else {
          const ffmpeg = findFfmpeg();
          const voice = toVoiceFormat(audio, ffmpeg, options.output);
          console.log(chalk.dim(`  语音: ${voice.file} (${voice.format})`));
          const b64 = readFileSync(voice.file).toString('base64');
          message = [{ type: 'record', data: { file: `base64://${b64}` } }];
        }
      } else {
        message = reply;
      }

      // 3) 发送（带超时/重试/熔断，失败进死信）
      const kind = String(options.kind || 'private').toLowerCase() === 'group' ? 'group' : 'private';
      const dlq = new DeadLetterQueue(dlqDir());
      try {
        await withResilience(async () => {
          const client = authManager.getClient();
          if (kind === 'group') await client.sendGroupMessage(target, message);
          else await client.sendPrivateMessage(target, message);
        }, {
          timeoutMs: 20000,
          attempts: 3,
          backoffMs: 1500,
          breaker,
          breakerKey: `send:${kind}:${target}`,
          onRetry: (i) => console.log(chalk.dim(`  第 ${i.attempt} 次失败，${i.delayMs}ms 后重试`)),
        });
        console.log(chalk.green(`已发到 ${kind === 'group' ? '群' : 'QQ'} ${target}（${decision.medium}）`));
      } catch (error) {
        dlq.push({
          kind: 'reply',
          payload: { to: target, kind, message, text: reply, medium: decision.medium },
          error: (error as Error).message,
          attempts: 3,
          context: { source: 'qce reply' },
        });
        console.log(chalk.red(`发送失败，已进死信队列: ${(error as Error).message}`));
        console.log(chalk.dim('查看：qce dlq list　重放：qce dlq replay <id>'));
      }
    });

  program
    .command('dlq')
    .description('死信队列（发送失败但没丢的消息）')
    .option('--replay <id>', '重放一条', '')
    .option('--clear', '清空')
    .action((options) => {
      const dlq = new DeadLetterQueue(dlqDir());
      if (options.clear) {
        console.log(chalk.green(`已清空 ${dlq.clear()} 条`));
        return;
      }
      if (options.replay) {
        const entry = dlq.take(String(options.replay));
        if (!entry) {
          console.log(chalk.red(`没有 id 为 ${options.replay} 的死信`));
          return;
        }
        console.log(chalk.cyan(`重放 ${entry.id}: ${entry.error}`));
        console.log(JSON.stringify(entry.payload, null, 2));
        return;
      }
      const all = dlq.all();
      if (all.length === 0) {
        console.log(chalk.green('死信队列是空的'));
        return;
      }
      console.log(chalk.cyan(`死信 ${all.length} 条：`));
      for (const e of all) {
        console.log(`  ${e.id}  ${e.kind}  ${new Date(e.createdAt).toLocaleString()}  ${e.error}`);
      }
    });
}
