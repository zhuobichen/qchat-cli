import { Command } from 'commander';
import chalk from 'chalk';
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { authManager } from '../core/auth.js';
import { safetyManager } from '../core/safety.js';
import { MessageStore, defaultIndexRoot } from '../core/message-store.js';
import {
  saveCandidate, renderCandidates, applyCandidates, looksLikeEmoji, type CollectCandidate,
} from '../core/face-collect.js';
import {
  pickUnlabeled, describeImage, readEmojiBytes, loadManifestFile, saveManifest,
} from '../core/emoji-label.js';
import { addDirectoryToLibrary, loadLibraryManifest } from '../core/emoji-add.js';
import { facePeekCommand } from './face-peek.js';
import { pickStickerMerged, stickerFile } from '../core/sticker.js';

const LIBRARY_DIR = 'private/emoji-library';
const CANDIDATE_DIR = 'private/emoji-candidates';

function loadManifest(): { version: 1; emojis: Array<{ hash: string; label: string; file: string; importedAt: string }> } {
  const p = join(LIBRARY_DIR, 'manifest.json');
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return { version: 1, emojis: [] };
  }
}

export function faceCommandExtended(program: Command): void {
  const target = program.commands.find((c) => c.name() === 'face');
  if (!target) return;   // face 命令由 faceCommand 负责创建，这里只挂子命令

  target.addCommand(facePeekCommand);

  target
    .command('collect [group]')
    .description('从群消息的图片里自动收集表情（去重，先进候选目录）')
    .option('-g, --group <id>', '群号（也可以作为位置参数）')
    .option('-n, --limit <n>', '最多处理多少张', '50')
    .option('--apply', '把候选正式并入表情库')
    .option('--dry', '只看会收哪些，不落盘')
    .action(async (groupArg, options) => {
      const groupId = Number(groupArg ?? options.group);
      if (!Number.isFinite(groupId) || groupId <= 0) {
        console.log(chalk.red('需要群号：qce face collect <群号>'));
        return;
      }

      const store = new MessageStore(defaultIndexRoot());
      const docs = store.load(groupId).filter((d) => d.images?.length);
      if (docs.length === 0) {
        console.log(chalk.yellow(`群 ${groupId} 的本地索引里没有带图片的消息（先跑 qce index ${groupId} --ocr）`));
        return;
      }

      const manifest = loadManifest();
      const known = new Set(manifest.emojis.map((e) => e.hash));
      // 候选目录里已有的也要算进去，否则重复扫会把同一张图再报一次"新候选"
      try {
        for (const name of readdirSync(CANDIDATE_DIR)) known.add(name.replace(/\.[^.]+$/, ''));
      } catch { /* 目录还不存在 */ }
      const limit = Number(options.limit) || 50;
      const candidates: CollectCandidate[] = [];

      if (!authManager.isConfigured()) {
        console.log(chalk.red('需要 NapCatQQ 连接才能取图'));
        return;
      }
      const client = authManager.getClient() as any;

      let scanned = 0;
      for (const doc of docs) {
        for (const ref of doc.images ?? []) {
          if (candidates.length >= limit) break;
          scanned += 1;
          try {
            const info = await client.getImage(ref);
            const local = typeof info?.file === 'string' && existsSync(info.file) ? info.file : '';
            if (!local) continue;
            const buf = readFileSync(local);
            const verdict = looksLikeEmoji(buf);
            if (!verdict.ok) {
              if (options.dry || process.env.QCE_VERBOSE) console.log(chalk.dim(`  跳过 ${ref.slice(-16)}：${verdict.reason}`));
              continue;
            }
            if (options.dry) {
              const { candidate } = saveCandidate(buf, ref, CANDIDATE_DIR, new Set([...known]));
              candidates.push(candidate);
              continue;
            }
            const { added, candidate } = saveCandidate(buf, ref, CANDIDATE_DIR, known);
            if (added) {
              known.add(candidate.hash);
              candidates.push(candidate);
            }
          } catch {
            // 单张失败跳过
          }
        }
      }

      console.log(chalk.cyan(`扫描 ${scanned} 张图，新候选 ${candidates.length} 个`));
      console.log(renderCandidates(candidates));

      if (options.apply) {
        if (options.dry) {
          console.log(chalk.yellow('--dry 与 --apply 不能同时用'));
          return;
        }
        // 把候选目录里所有文件都算进来（不只是本次新扫到的）
        const fromDir: CollectCandidate[] = [];
        try {
          for (const name of readdirSync(CANDIDATE_DIR)) {
            const dot = name.lastIndexOf('.');
            if (dot < 0) continue;
            fromDir.push({ hash: name.slice(0, dot), ext: name.slice(dot), bytes: 0, source: name });
          }
        } catch { /* 空 */ }
        const toApply = fromDir.length > 0 ? fromDir : candidates;
        const { added, total } = applyCandidates(toApply, CANDIDATE_DIR, LIBRARY_DIR, manifest);
        console.log(chalk.green(`已并入表情库：+${added}，现有 ${total} 个`));
      } else if (candidates.length > 0) {
        console.log(chalk.dim(`确认无误后执行：qce face collect ${groupId} --apply`));
      }
    });

  target
    .command('send <intent>')
    .description('挑一张表情发出去（本地库与 memecub 一起挑，斗图用）')
    .option('-t, --to <id>', 'QQ 号或群号（必填）')
    .option('-k, --kind <k>', 'private（默认）或 group', 'private')
    .option('--dry', '只挑不发，看看会选哪张')
    .action(async (intent, options) => {
      const to = String(options.to ?? '').trim();
      if (!to && !options.dry) {
        console.log(chalk.red('缺少 --to（QQ 号或群号）'));
        return;
      }

      const picked = await pickStickerMerged(String(intent));
      if (!picked) {
        console.log(chalk.yellow(`没有匹配「${intent}」的表情（宁可不发，也不发不搭的）`));
        return;
      }

      const kind = options.kind === 'group' ? 'group' : 'private';
      console.log(chalk.cyan(`选中「${picked.label}」（${picked.origin}${picked.remoteUrl ? ' 在线' : ' 本地'}）`));
      if (options.dry) return;

      // 本地图直接发；memecub 的先下载
      let file = picked.origin === 'local' ? stickerFile(picked.id) : null;
      if (!file && picked.remoteUrl) {
        const dir = join(LIBRARY_DIR, '..', 'output', 'memes');
        mkdirSync(dir, { recursive: true });
        const res = await fetch(picked.remoteUrl, { signal: AbortSignal.timeout(30_000) });
        if (!res.ok) {
          console.log(chalk.red(`下载失败 HTTP ${res.status}`));
          return;
        }
        const ctype = String(res.headers.get('content-type') ?? '');
        const ext = ctype.includes('png') ? 'png' : ctype.includes('gif') ? 'gif' : ctype.includes('webp') ? 'webp' : 'jpg';
        file = join(dir, `meme-${Date.now()}.${ext}`);
        writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      }
      if (!file) {
        console.log(chalk.red('拿不到图片文件'));
        return;
      }

      if (!safetyManager.isAllowed(Number(to))) {
        console.log(chalk.red(`会话 ${to} 未授权发送（qce safety allow ${to}）`));
        return;
      }
      try {
        const client = authManager.getClient();
        const message = [{ type: 'image', data: { file } }] as any;
        if (kind === 'group') await client.sendGroupMessage(Number(to), message);
        else await client.sendPrivateMessage(Number(to), message);
        console.log(chalk.green(`表情已发送到 ${kind === 'group' ? '群' : 'QQ'} ${to}`));
      } catch (error) {
        console.log(chalk.red(`发送失败: ${(error as Error).message}`));
      }
    });

  target
    .command('add <dir>')
    .description('把一个目录的图片直接导进本地表情库（send_sticker 立即可用，无需账号）')
    .option('-l, --label <prefix>', '标签前缀，方便以后按关键词搜到', '')
    .option('--max-mb <n>', '单张大小上限（MB）', '2')
    .option('--dry', '只看会加哪些，不落盘')
    .action((dir, options) => {
      if (!existsSync(dir)) {
        console.log(chalk.red(`目录不存在：${dir}`));
        return;
      }
      const manifest = loadLibraryManifest(LIBRARY_DIR);
      const before = manifest.emojis.length;

      if (options.dry) {
        // 干跑：只统计，不写任何文件
        const known = new Set(manifest.emojis.map((e) => e.hash));
        const maxBytes = Number(options.maxMb || 2) * 1024 * 1024;
        let willAdd = 0;
        const reasons: string[] = [];
        for (const name of readdirSync(dir)) {
          const full = join(dir, name);
          const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
          if (!['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) continue;
          const buf = readFileSync(full);
          if (buf.length > maxBytes) { reasons.push(`${name}: 超过 ${Math.round(maxBytes / 1024 / 1024)}MB`); continue; }
          const h = createHash('sha256').update(buf).digest('hex');
          if (known.has(h)) { reasons.push(`${name}: 已存在`); continue; }
          willAdd += 1;
        }
        console.log(chalk.cyan(`会新增 ${willAdd} 张，跳过 ${reasons.length} 张`));
        for (const r of reasons.slice(0, 5)) console.log(chalk.dim(`  ${r}`));
        return;
      }

      const { added, skipped } = addDirectoryToLibrary(dir, LIBRARY_DIR, manifest, {
        ...(options.label ? { labelPrefix: String(options.label) } : {}),
        maxBytes: Number(options.maxMb || 2) * 1024 * 1024,
      });

      console.log(chalk.green(`已导入 ${added.length} 张，本地库 ${before} → ${before + added.length}`));
      for (const s of skipped.slice(0, 8)) console.log(chalk.dim(`  跳过 ${s.file}: ${s.reason}`));
      if (skipped.length > 8) console.log(chalk.dim(`  … 还有 ${skipped.length - 8} 张被跳过`));
      if (added.length > 0) {
        console.log(chalk.dim('提示：标签目前是「前缀 + 文件名」，可用 qce face label 补更好的描述'));
      }
    });

  target
    .command('label [hash] [label]')
    .description('表情打标：不带参数=列出待标项；给 hash 与 label=直接写入；--vision=调视觉模型')
    .option('-n, --limit <n>', 'vision 模式本次最多标几个', '10')
    .option('--vision', '调视觉模型自动打标（需要 QCE_VISION_KEY）')
    .option('--dry', '只打印将要标什么，不写回')
    .action(async (hashArg, labelArg, options) => {
      const manifestPath = join(LIBRARY_DIR, 'manifest.json');
      const manifest = loadManifestFile(manifestPath);

      // 手动写入模式：qce face label <hash> <label>
      if (hashArg && labelArg) {
        const hit = manifest.emojis.find((e) => e.hash === hashArg || e.hash.startsWith(hashArg));
        if (!hit) {
          console.log(chalk.red(`没找到 hash 为 ${hashArg} 的表情`));
          return;
        }
        hit.label = String(labelArg).slice(0, 30);
        saveManifest(manifestPath, manifest);
        console.log(chalk.green(`${hit.hash.slice(0, 8)} → ${hit.label}`));
        return;
      }

      // 列表模式：给人和 agent 看图片路径
      if (!options.vision) {
        const pending = pickUnlabeled(manifest, 999);
        if (pending.length === 0) {
          console.log(chalk.green('没有待分类的表情'));
          return;
        }
        console.log(chalk.cyan(`待标 ${pending.length} 个（看图后执行：qce face label <hash> <标签>）`));
        for (const r of pending) {
          console.log(`${r.hash.slice(0, 10)}  ${join(LIBRARY_DIR, r.file)}`);
        }
        return;
      }

      const pending = pickUnlabeled(manifest, Number(options.limit) || 10);
      if (pending.length === 0) {
        console.log(chalk.green('没有待分类的表情'));
        return;
      }

      const apiKey = process.env.QCE_VISION_KEY || '';
      if (!apiKey) {
        console.log(chalk.red('需要 QCE_VISION_KEY（302.AI 或其他 OpenAI 兼容视觉模型的 key）'));
        console.log(chalk.dim('用法: QCE_VISION_KEY=sk-... qce face label'));
        return;
      }

      let labeled = 0;
      for (const record of pending) {
        const bytes = readEmojiBytes(LIBRARY_DIR, record);
        if (!bytes) {
          console.log(chalk.yellow(`${record.hash.slice(0, 8)}: 文件缺失，跳过`));
          continue;
        }
        const label = await describeImage(bytes, {
          apiKey,
          ...(process.env.QCE_VISION_MODEL ? { model: process.env.QCE_VISION_MODEL } : {}),
        });
        if (!label) {
          console.log(chalk.yellow(`${record.hash.slice(0, 8)}: 描述失败，跳过`));
          continue;
        }
        console.log(`${record.hash.slice(0, 8)} → ${label}`);
        if (!options.dry) {
          record.label = label;
          labeled += 1;
        }
      }

      if (!options.dry && labeled > 0) {
        saveManifest(manifestPath, manifest);
        console.log(chalk.green(`已标注 ${labeled} 个`));
      }
    });
}
