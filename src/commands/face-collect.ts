import { Command } from 'commander';
import chalk from 'chalk';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { authManager } from '../core/auth.js';
import { MessageStore, defaultIndexRoot } from '../core/message-store.js';
import {
  saveCandidate, renderCandidates, applyCandidates, type CollectCandidate,
} from '../core/face-collect.js';

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
}
