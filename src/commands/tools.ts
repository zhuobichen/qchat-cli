/**
 * 统一工具层：四个固定动作，一套固定的目标写法。
 *
 * 为什么要有它：同样一件事（发张图）原来有四种写法——直接发 CQ 码、走 send group、
 * 先 gen-media 再 send、或者拆到别的地方。工具一散，每次都得现查怎么调，
 * 也容易踩"相对路径 NapCat 不认""视频要绝对路径"这类坑。
 *
 * 这里只解决一件事：**参数只有一种写法，返回只有一种格式**。
 * 上层（MCP）只做薄封装，出问题能退回到这一层查。
 *
 * 目标写法：
 *   group:913807639    群
 *   user:1473517806    私聊
 *
 * 子命令：
 *   qce say   <目标> <文本>             发文本（支持 [CQ:at,qq=xxx]）
 *   qce pic   <目标> <图片路径|URL>     发图
 *   qce media <目标> <文件路径>         发视频/语音/文件（按扩展名判断）
 *   qce see   <图片路径|URL>            看图（纯文字走 OCR、有画面走千问）
 */
import { Command } from 'commander';
import { existsSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import { authManager } from '../core/auth.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

type Target = { kind: 'group' | 'user'; id: number };

/** 解析 "group:913807639" / "user:1473517806"，也接受裸数字（按群算） */
function parseTarget(raw: string): Target {
  const s = String(raw || '').trim();
  const m = s.match(/^(group|user|群|私聊)[:：]?(\d{5,12})$/i);
  if (m) {
    const kind = /^u|私/i.test(m[1]) ? 'user' : 'group';
    return { kind, id: Number(m[2]) };
  }
  if (/^\d{5,12}$/.test(s)) return { kind: 'group', id: Number(s) };
  throw new Error(`目标写法不对：「${s}」。要 group:<群号> 或 user:<QQ号>`);
}

/** 图片：本地必须存在，URL 直接透传 */
function imagePath(raw: string): string {
  const s = String(raw || '').trim();
  if (/^https?:\/\//i.test(s)) return s;
  const abs = resolve(process.cwd(), s);
  if (!existsSync(abs)) throw new Error(`文件不存在: ${abs}`);
  return abs;
}

/** 媒体：必须是绝对路径（NapCat 只认绝对路径，相对路径会报「识别URL失败」） */
function mediaFile(raw: string): string {
  const abs = resolve(process.cwd(), String(raw || '').trim());
  if (!existsSync(abs)) throw new Error(`文件不存在: ${abs}`);
  const st = statSync(abs);
  if (st.isDirectory()) throw new Error(`这是目录不是文件: ${abs}`);
  return abs;
}

/** 统一返回：成功只给一行 ok，失败给可读原因 */
function report(ok: boolean, what: string, detail = ''): void {
  if (ok) {
    console.log(detail ? `ok  ${what}  ${detail}` : `ok  ${what}`);
  } else {
    console.error(`fail  ${what}${detail ? '  ' + detail : ''}`);
    process.exitCode = 1;
  }
}

async function sendSegments(target: Target, message: any[]): Promise<any> {
  const client = authManager.getClient();
  if (target.kind === 'group') {
    return client.sendGroupMessage(target.id, message as any);
  }
  return client.sendPrivateMessage(target.id, message as any);
}

/** 按扩展名判断该用哪个消息段 */
function segmentFor(abs: string) {
  const ext = extname(abs).toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'].includes(ext)) {
    return { type: 'image', data: { file: abs } };
  }
  if (['.mp4', '.mov', '.webm', '.mkv'].includes(ext)) {
    return { type: 'video', data: { file: abs } };
  }
  if (['.silk', '.amr', '.mp3', '.wav', '.ogg', '.flac', '.m4a'].includes(ext)) {
    return { type: 'record', data: { file: abs } };
  }
  return { type: 'file', data: { file: abs, name: abs.split(/[\\/]/).pop() } };
}

/**
 * 像人一样发消息：打字延迟 + 每分钟频率上限。
 *
 * 为什么要做（2026-11-11 查到的做法，见 rules.md 第 10 节）：
 * 机器人被踢下线的原因里，「秒回」是很显眼的一条——真人不会在别人说完话
 * 200 毫秒内就整段回复。别人踩过坑的配置是：基础 1 秒 + 每字 0.03 秒、
 * 上限 3 秒，再叠 ±20% 抖动；同时一分钟别超过 10 条。
 *
 * 这不是为了"骗过风控"，而是让行为别那么像脚本：
 * 一晚上被踢五次之后，任何能降噪的事都值得做。
 */
const RATE_FILE = join(ROOT, 'output', '.say-rate.json');
const MAX_PER_MINUTE = 10;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function humanPacing(text: string): Promise<string> {
  const base = 1000 + text.length * 30;
  const capped = Math.min(base, 3000);
  const jittered = Math.round(capped * (0.8 + Math.random() * 0.4));

  // 频率上限：最近 60 秒内已经发了多少条
  let recent: number[] = [];
  try {
    recent = (JSON.parse(readFileSync(RATE_FILE, 'utf8')) as number[]).filter((t) => Date.now() - t < 60_000);
  } catch { /* 没有记录就从零算 */ }
  let note = '';
  if (recent.length >= MAX_PER_MINUTE) {
    const waitFor = 60_000 - (Date.now() - recent[0]) + 200;
    note = `限流等 ${Math.round(waitFor / 1000)}s`;
    await sleep(waitFor);
    recent = recent.filter((t) => Date.now() - t < 60_000);
  }
  await sleep(jittered);
  recent.push(Date.now());
  try { writeFileSync(RATE_FILE, JSON.stringify(recent), 'utf8'); } catch { /* 记不上就算了 */ }
  return note;
}

export function toolsCommand(program: Command): void {
  // ── say：发文本 ───────────────────────────────────────
  program
    .command('say <target> <text>')
    .description('发文本。目标写 group:<群号> 或 user:<QQ号>')
    // 兼容旧习惯：以前 `qce send` 要 --force，顺手传过来不该让整条命令报错退出。
    // 踩过：多传一个 --force，commander 直接 error 退出，消息**一声不响地没发出去**，
    // 我还以为发了。忽略多余参数，比静默失败强。
    .allowUnknownOption(true)
    .option('--force', '兼容旧用法，忽略')
    .action(async (targetRaw: string, text: string) => {
      try {
        const target = parseTarget(targetRaw);
        if (!String(text || '').trim()) throw new Error('文本是空的');
        const pace = await humanPacing(String(text));
        await sendSegments(target, [{ type: 'text', data: { text } }]);
        report(true, `say → ${target.kind}:${target.id}`, `${text.slice(0, 24)}…${pace ? `（${pace}）` : ''}`);
      } catch (e: any) {
        report(false, 'say', e?.message || String(e));
      }
    });

  // ── pic：发图 ─────────────────────────────────────────
  program
    .command('pic <target> <image>')
    .description('发图。image 可以是本地路径或 http(s) URL')
    .action(async (targetRaw: string, image: string) => {
      try {
        const target = parseTarget(targetRaw);
        const p = imagePath(image);
        await sendSegments(target, [{ type: 'image', data: { file: p } }]);
        report(true, `pic → ${target.kind}:${target.id}`, p.split(/[\\/]/).pop());
      } catch (e: any) {
        report(false, 'pic', e?.message || String(e));
      }
    });

  // ── media：视频 / 语音 / 文件 ─────────────────────────
  program
    .command('media <target> <file>')
    .description('发视频/语音/文件，按扩展名自动判断类型')
    .action(async (targetRaw: string, file: string) => {
      try {
        const target = parseTarget(targetRaw);
        const abs = mediaFile(file);
        const seg = segmentFor(abs);
        await sendSegments(target, [seg]);
        report(true, `media(${seg.type}) → ${target.kind}:${target.id}`, abs.split(/[\\/]/).pop());
      } catch (e: any) {
        report(false, 'media', e?.message || String(e));
      }
    });

  // ── poke：戳一戳 ──────────────────────────────────────
  //
  // 为什么以前戳不了：戳一戳走 QQ 的 packet 层（NapCat 的 PacketBackend），
  // 4.18.1 只认旧版 QQ 的包结构，QQ 升到 9.9.33-52230 后就报
  // 「PacketBackend 不支持当前QQ版本架构」。这错只在调用时暴露，
  // 平时发消息、读历史都正常，所以一直没被发现。换成 4.18.42 才好。
  program
    .command('poke <target> [user]')
    .description('戳一戳。群聊写 group:<群号> <QQ号>，私聊写 user:<QQ号>')
    .action(async (targetRaw: string, user?: string) => {
      try {
        const target = parseTarget(targetRaw);
        const client = authManager.getClient();
        if (target.kind === 'group') {
          const uid = Number(String(user || '').trim());
          if (!uid) throw new Error('群戳要给 QQ 号：qce poke group:<群号> <QQ号>');
          await client.call('group_poke', { group_id: target.id, user_id: uid });
          report(true, `poke → group:${target.id}`, `戳了 ${uid}`);
        } else {
          await client.call('friend_poke', { user_id: target.id });
          report(true, `poke → user:${target.id}`, '戳了');
        }
      } catch (e: any) {
        report(false, 'poke', e?.message || String(e));
      }
    });

  // ── draw：生图（MiniMax） ─────────────────────────────
  //
  // 为什么默认走 MiniMax：豆包那条路要开桌面版 GUI、一张 15~35 秒、还不能并发。
  // MiniMax 是纯 HTTP（国内站 api.minimaxi.com），能指定比例、能一次出多张、
  // 直接回 base64 自己落盘。号主 2026-11-12 给的 key 只认国内站——
  // 国际站 api.minimax.io 会回 2049 invalid api key，这个坑记在 rules.md。
  program
    .command('draw <prompt>')
    .description('用 MiniMax image-01 生图。默认 16:9，输出绝对路径')
    .option('--ar <ratio>', '宽高比，如 16:9 / 1:1 / 9:16', '16:9')
    .option('--n <count>', '张数（1-4）', '1')
    .option('--name <stem>', '文件名主干')
    .option('--url', '只回图片 URL，不落盘')
    .action((prompt: string, options: { ar?: string; n?: string; name?: string; url?: boolean }) => {
      try {
        const args = [join(ROOT, 'scripts', 'minimax-image.mjs'), prompt];
        if (options.ar) args.push('--ar', options.ar);
        if (options.n) args.push('--n', options.n);
        if (options.name) args.push('--name', options.name);
        if (options.url) args.push('--url');
        const r = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 240000 });
        const out = ((r.stdout || '') + (r.stderr || '')).trim();
        if (r.status !== 0) {
          report(false, 'draw', out.slice(-300));
          return;
        }
        // 只把 IMAGE_PATH/IMAGE_URL 那几行亮出来，其余信息压成一句
        const lines = out.split('\n');
        const paths = lines.filter((l) => l.startsWith('IMAGE_PATH=') || l.startsWith('IMAGE_URL='));
        const meta = lines.filter((l) => l.startsWith('BASE=')).join(' ');
        for (const p of paths) console.log(p);
        report(paths.length > 0, `draw ${paths.length} 张`, meta);
      } catch (e: any) {
        report(false, 'draw', e?.message || String(e));
      }
    });

  // ── see：看图 ─────────────────────────────────────────
  program
    .command('see <image>')
    .description('看图：纯文字截图走 OCR，有画面走千问视觉（自动分流）')
    .option('--ask <question>', '想问什么')
    .action((image: string, options: { ask?: string }) => {
      try {
        const p = imagePath(image);
        const args = [join(ROOT, 'scripts', 'read-image.mjs'), p];
        if (options.ask) args.push('--ask', options.ask);
        const r = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 120000 });
        const out = ((r.stdout || '') + (r.stderr || '')).trim();
        if (r.status !== 0) {
          report(false, 'see', out.slice(0, 200));
          return;
        }
        console.log(out);
      } catch (e: any) {
        report(false, 'see', e?.message || String(e));
      }
    });
}
