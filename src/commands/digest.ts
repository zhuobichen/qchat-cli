import { Command } from 'commander';
import chalk from 'chalk';
import { writeFileSync, mkdirSync, readFileSync } from 'fs';
import { spawnSync } from 'node:child_process';
import { buildSendPlan, formatPlan, toRelativeBodyFile } from '../core/push.js';
import path from 'node:path';
import { join } from 'path';
import { authManager } from '../core/auth.js';
import { buildDigest, renderDigestMarkdown, renderDigestText, type DigestMessage } from '../core/digest.js';
import { resolveSession } from '../utils/resolveSession.js';
import { safetyManager } from '../core/safety.js';
import { MessageStore, defaultIndexRoot } from '../core/message-store.js';

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
    .option('--push <email>', '把日报发到这个邮箱（调用本机 agently-cli，需已登录）')
    .option('--push-dry', '只打印将要执行的发信命令，不真的发送')
    .option('--send-to <id>', '把日报摘要直接发到这个 QQ 号或群号')
    .option('--send-kind <kind>', '发送类型：private（默认）或 group', 'private')
    .option('--force', '跳过发送确认')
    .option('--from-index', '不联网，直接用本地索引（qce index 建的）出日报')
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

      if (options.fromIndex) {
        const store = new MessageStore(defaultIndexRoot());
        for (const m of store.load(groupId)) {
          if (cutoff && m.time < cutoff) continue;
          if (byId.size >= limit) break;
          byId.set(m.id, { time: m.time, senderId: m.senderId, senderName: m.senderName, text: m.text });
        }
      }

      while (!options.fromIndex && byId.size < limit && guard < 60) {
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

      if (options.push) {
        const plan = buildSendPlan({
          to: String(options.push),
          subject: `群日报 ${groupId} ${new Date().toISOString().slice(0, 10)}`,
          bodyFile: toRelativeBodyFile(file),
        });
        if (options.pushDry) {
          console.log(chalk.cyan('发信命令（未执行）:'));
          console.log(`  ${formatPlan(plan)}`);
        } else {
          try {
            const r = spawnSync(plan.bin, plan.args, { encoding: 'utf8', env: { ...process.env, ...(plan.env ?? {}) } });
            if (r.status === 0) console.log(chalk.green(`已发送到 ${options.push}`));
            else console.log(chalk.red(`发送失败: ${(r.stderr || r.stdout || '').trim().slice(0, 300)}`));
          } catch (error) {
            console.log(chalk.red(`发送失败: ${(error as Error).message}`));
          }
        }
      }

      if (options.sendTo) {
        const targetId = await resolveSession(String(options.sendTo));
        const kind = String(options.sendKind || 'private').toLowerCase() === 'group' ? 'group' : 'private';

        if (!safetyManager.isAllowed(targetId)) {
          console.log(chalk.red(`会话 ${targetId} 未授权发送，先执行: qce safety allow ${targetId}`));
        } else {
          const client = authManager.getClient();
          const text = renderDigestText(digest);
          let ok = false;
          try {
            if (kind === 'group') {
              // 群优先发文件（完整 Markdown），失败退回文本摘要
              try {
                await client.uploadGroupFile(targetId, file, path.basename(file));
                ok = true;
              } catch {
                await client.sendGroupMessage(targetId, text);
                ok = true;
              }
            } else {
              await client.sendPrivateMessage(targetId, text);
              ok = true;
            }
          } catch (error) {
            console.log(chalk.red(`发送失败: ${(error as Error).message}`));
          }
          if (ok) console.log(chalk.green(`日报已发到 ${kind === 'group' ? '群' : 'QQ'} ${targetId}`));
        }
      }

      console.log(`  消息: ${digest.total} 条 / ${digest.participants} 人`);
      digest.speakers.slice(0, 3).forEach((s) => console.log(chalk.dim(`  ${s.name}: ${s.count} 条`)));
    });
}
