import { Command } from 'commander';
import chalk from 'chalk';
import { writeFileSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { authManager } from '../core/auth.js';
import { buildDigest, renderDigestMarkdown, type DigestMessage } from '../core/digest.js';
import { resolveSession } from '../utils/resolveSession.js';

/** 把 OneBot 消息段压成纯文本（与 group-history 脚本口径一致） */
function flatten(message: unknown): string {
  if (typeof message === 'string') return message;
  if (!Array.isArray(message)) return '';
  return message
    .map((seg: any) => {
      switch (seg?.type) {
        case 'text': return seg.data?.text ?? '';
        case 'image': return '[图片]';
        case 'face': return '[表情]';
        case 'mface': return '[表情包]';
        case 'at': return `@${seg.data?.qq === 'all' ? '全体成员' : seg.data?.qq}`;
        case 'record': return '[语音]';
        case 'video': return '[视频]';
        case 'file': return '[文件]';
        case 'reply': return '[回复]';
        case 'json':
        case 'xml': return '[卡片]';
        case 'forward': return '[合并转发]';
        default: return `[${seg?.type ?? '未知'}]`;
      }
    })
    .join('')
    .trim();
}

/** 调 OpenAI 兼容接口做一段摘要；失败返回 undefined（不阻断日报生成） */
async function aiSummarize(text: string, cfg: { baseUrl: string; model: string; apiKey: string }): Promise<string | undefined> {
  try {
    const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0.3,
        messages: [
          { role: 'system', content: '你是群聊分析助手。用 3-5 条要点总结这段群聊：主要话题、达成的结论、待办/悬而未决的事。中文，每条不超过 40 字，不要复述原文。' },
          { role: 'user', content: text.slice(0, 12000) },
        ],
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return undefined;
    const json: any = await res.json();
    const content = json?.choices?.[0]?.message?.content;
    return typeof content === 'string' ? content : undefined;
  } catch {
    return undefined;
  }
}

export function digestCommand(program: Command): void {
  program
    .command('digest [session]')
    .description('生成群日报（谁在聊、什么时候活跃、值得回看的消息）')
    .option('-n, --limit <number>', '拉取的消息条数上限', '500')
    .option('--days <number>', '只要最近 N 天')
    .option('-o, --output <path>', '输出目录', './output')
    .option('--ai', '调用 private/group-bot.config.json 里的模型生成 AI 摘要')
    .option('--stdout', '同时打印到终端')
    .action(async (session, options) => {
      if (!authManager.isConfigured()) {
        console.log(chalk.red('请先配置 NapCatQQ 连接'));
        console.log(chalk.dim('运行: qce login --host <host> --port <port>'));
        return;
      }
      if (!session) {
        console.log(chalk.red('请指定群号或群名，例如: qce digest 123456789'));
        return;
      }

      const groupId = await resolveSession(session);
      const client = authManager.getClient();
      const limit = Math.min(Math.max(Number(options.limit) || 500, 1), 5000);
      const cutoff = options.days ? Math.floor(Date.now() / 1000) - Number(options.days) * 86400 : 0;

      const byId = new Map<string, DigestMessage>();
      let seq: number | undefined;
      let guard = 0;

      while (byId.size < limit && guard < 60) {
        guard += 1;
        const batch = await client.getGroupMsgHistory(groupId, seq, Math.min(100, limit - byId.size));
        const messages = batch?.messages ?? [];
        if (messages.length === 0) break;

        for (const m of messages) {
          if (cutoff && m.time < cutoff) continue;
          const key = String(m.message_id ?? `${m.time}:${m.message_seq}`);
          if (byId.has(key)) continue;
          byId.set(key, {
            time: m.time,
            senderId: m.sender?.user_id ?? m.user_id,
            senderName: (m.sender as any)?.card || (m.sender as any)?.nickname || String(m.sender?.user_id ?? m.user_id),
            text: flatten(m.message),
          });
        }

        const oldest = messages.reduce((a, b) => (a.message_seq <= b.message_seq ? a : b));
        if (oldest.message_seq === seq) break;
        seq = oldest.message_seq;
        if (cutoff && oldest.time < cutoff) break;
      }

      const messages = [...byId.values()].sort((a, b) => a.time - b.time);
      if (messages.length === 0) {
        console.log(chalk.yellow('这段时间没有取到消息（群号是否正确？NapCat 是否只缓存了最近消息？）'));
        return;
      }

      console.log(chalk.dim(`已取到 ${messages.length} 条消息，生成日报...`));
      const digest = buildDigest(messages, { title: `群 ${groupId} 日报` });

      let aiSummary: string | undefined;
      if (options.ai) {
        const cfgPath = join(process.cwd(), 'private', 'group-bot.config.json');
        try {
          const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
          if (cfg?.baseUrl && cfg?.model && cfg?.apiKey) {
            const plain = messages.map((m) => `${m.senderName}: ${m.text}`).join('\n');
            aiSummary = await aiSummarize(plain, cfg);
            if (!aiSummary) console.log(chalk.yellow('AI 摘要失败，已跳过（日报其余部分正常）'));
          } else {
            console.log(chalk.yellow('private/group-bot.config.json 缺少 baseUrl/model/apiKey，已跳过 AI 摘要'));
          }
        } catch {
          console.log(chalk.yellow('读不到 private/group-bot.config.json，已跳过 AI 摘要'));
        }
      }

      const md = renderDigestMarkdown(digest, aiSummary);
      mkdirSync(options.output, { recursive: true });
      const file = join(options.output, `digest-${groupId}-${new Date().toISOString().slice(0, 10)}.md`);
      writeFileSync(file, md, 'utf8');

      if (options.stdout) console.log(md);

      console.log(chalk.green('日报已生成!'));
      console.log(`  文件: ${file}`);
      console.log(`  消息: ${digest.total} 条 / ${digest.participants} 人`);
      digest.speakers.slice(0, 3).forEach((s) => console.log(chalk.dim(`  ${s.name}: ${s.count} 条`)));
    });
}
