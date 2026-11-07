import { Command } from 'commander';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join as joinPath, resolve as resolvePath } from 'node:path';
import chalk from 'chalk';

import { findFfmpeg } from '../core/tts.js';
import { convertSingingAuto, findSeedVcDir, findSeedVcPython } from './sing.js';
import { findYtDlp, makeTempDir } from './video.js';

/**
 * `qce song <歌名>` —— 点歌：搜 B 站 → 下载 → 分人声 → 换成目标音色。
 *
 * 为什么不起 MCP：现成的音乐 MCP 都只给元数据（版权原因拿不到音频）。
 * 实际可行的是自己搜 + 自己下 + 自己分离。
 *
 * 关键坑：B 站搜索 API 必须带 buvid3 cookie，否则一律 HTTP 412。
 */

export interface SongSearchHit {
  title: string;
  duration: string;
  author: string;
  bvid: string;
  url: string;
  play: number;
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const COOKIE_FILE = '.bili.cookies';

/** 先把 buvid3 之类的基础 cookie 拿到，否则搜索接口 412 */
export function ensureBiliCookies(cookiePath = COOKIE_FILE): boolean {
  try {
    // 已经拿过就直接用（cookie 有效期较长）
    if (existsSync(cookiePath) && readFileSync(cookiePath, 'utf8').includes('buvid3')) return true;
    const r = spawnSync('curl', [
      '-s', '-m', '20', '-A', UA, '-c', cookiePath, '-o', '/dev/null', 'https://www.bilibili.com',
    ], { timeout: 30_000 });
    return existsSync(cookiePath) && readFileSync(cookiePath, 'utf8').includes('buvid3');
  } catch {
    return false;
  }
}

/** 搜 B 站视频 */
export function searchBilibili(keyword: string, limit = 8, cookiePath = COOKIE_FILE): SongSearchHit[] {
  if (!ensureBiliCookies(cookiePath)) {
    throw new Error('拿不到 bilibili cookie（buvid3），搜索接口会返回 412');
  }
  const url =
    'https://api.bilibili.com/x/web-interface/search/type?search_type=video&page=1&keyword=' +
    encodeURIComponent(keyword);
  const r = spawnSync('curl', [
    '-s', '-m', '25', '-A', UA, '-b', cookiePath, '-c', cookiePath,
    '-H', 'Referer: https://search.bilibili.com/',
    '-H', 'Accept: application/json, text/plain, */*',
    url,
  ], { encoding: 'utf8', timeout: 35_000 });
  let parsed: any;
  try {
    parsed = JSON.parse(r.stdout ?? '{}');
  } catch {
    throw new Error(`搜索返回不是 JSON: ${(r.stdout ?? '').slice(0, 120)}`);
  }
  if (parsed?.code !== 0) throw new Error(`搜索失败 code=${parsed?.code} ${parsed?.message ?? ''}`);
  const list = parsed?.data?.result ?? [];
  return list.slice(0, limit).map((x: any) => ({
    title: String(x.title ?? '').replace(/<[^>]+>/g, ''),
    duration: String(x.duration ?? ''),
    author: String(x.author ?? ''),
    bvid: String(x.bvid ?? ''),
    url: `https://www.bilibili.com/video/${x.bvid}`,
    play: Number(x.play ?? 0),
  }));
}

/**
 * 挑一个最像「原唱/完整版」的结果。
 *
 * 打分思路：优先完整曲（3~6 分钟），标题含原唱/完整/无损更好；
 * 排除伴奏/纯音乐/鼓谱/教程/翻唱教学这类不能拿来换音的。
 */
export function rankSongHits(hits: SongSearchHit[]): SongSearchHit[] {
  const bad = /伴奏|纯音乐|鼓谱|教程|教学|钢琴|吉他|翻弹|指弹|remix|dj版|混音|串烧|合集|反应|reaction|切片|解说/i;
  const good = /原唱|完整|无损|官方|mv|高音质|收藏级|hi-?res/i;
  const score = (h: SongSearchHit) => {
    let s = 0;
    const parts = h.duration.split(':').map(Number);
    const sec = parts.length === 2 ? parts[0] * 60 + parts[1] : 0;
    if (sec >= 150 && sec <= 360) s += 5;      // 正常一首歌的长度
    else if (sec >= 60) s += 1;
    if (bad.test(h.title)) s -= 20;
    if (good.test(h.title)) s += 3;
    if (h.play > 100_000) s += 2;
    else if (h.play > 10_000) s += 1;
    return s;
  };
  return [...hits].sort((a, b) => score(b) - score(a));
}

/** 下音频（只要音频，不下视频） */
export function downloadAudio(url: string, outDir: string, ytdlp = findYtDlp()): string {
  mkdirSync(outDir, { recursive: true });
  const tempDir = makeTempDir(joinPath(process.cwd(), '.tmp-ytdlp'), 'song');
  const r = spawnSync(ytdlp, [
    '-f', 'bestaudio/best', '--no-warnings', '-x', '--audio-format', 'wav',
    '-o', joinPath(outDir, 'src.%(ext)s'), url,
  ], {
    encoding: 'utf8',
    timeout: 900_000,
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, TEMP: tempDir, TMP: tempDir },
  });
  const files = existsSync(outDir)
    ? readdirSync(outDir).filter((f) => /^src\.(wav|m4a|mp3|opus|webm)$/i.test(f))
    : [];
  if (files.length === 0) {
    throw new Error(`下载失败: ${(r.stderr ?? r.stdout ?? '').slice(-200)}`);
  }
  // 要 wav：ffmpeg 转一遍更稳（yt-dlp 的 -x 有时给 opus）
  return joinPath(outDir, files[0]);
}

/** 用 demucs 分离人声；失败返回 null 表示需要退化处理 */
export function separateVocals(
  input: string,
  outDir: string,
  seedVcDir: string,
): { vocals: string } | null {
  const py = findSeedVcPython(seedVcDir);
  const r = spawnSync(py, ['-m', 'demucs', '--two-stems=vocals', '-n', 'htdemucs', '-o', outDir, input], {
    encoding: 'utf8',
    timeout: 1_800_000,
    maxBuffer: 32 * 1024 * 1024,
    env: {
      ...process.env,
      HF_HOME: joinPath(seedVcDir, '.hf-cache'),
      TORCH_HOME: joinPath(seedVcDir, '.torch-cache'),
      PYTHONIOENCODING: 'utf-8',
    },
  });
  // demucs 输出结构：<outDir>/htdemucs/<文件名>/vocals.wav
  const base = input.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, '');
  const guess = joinPath(outDir, 'htdemucs', base, 'vocals.wav');
  if (existsSync(guess)) return { vocals: guess };
  if (r.status !== 0) {
    return null;
  }
  return existsSync(guess) ? { vocals: guess } : null;
}

export interface SongOptions {
  ref: string;
  outDir?: string;
  pick?: number;
  steps?: number;
  skipSeparate?: boolean;
  query?: string;
  seedVcDir?: string;
  keepSource?: boolean;
}

export function songCommand(program: Command): void {
  program
    .command('song <name>')
    .description('点歌：搜 B 站 → 下载 → 分人声 → 换成目标音色（一条命令出成品）')
    .requiredOption('-r, --ref <file>', '参考音色（1~30 秒干净人声）')
    .option('-q, --query <text>', '附加搜索词，例如「清唱」「干声」')
    .option('-p, --pick <n>', '选第几个搜索结果（从 1 开始）', '1')
    .option('-o, --out-dir <dir>', '输出目录')
    .option('-s, --steps <n>', '扩散步数', '35')
    .option('--skip-separate', '跳过人声分离（源本身是清唱时用）')
    .action(async (name: string, options: Record<string, unknown>) => {
      try {
        const outDir = resolvePath(String(options.outDir ?? joinPath('output', 'song', `s-${Date.now()}`)));
        mkdirSync(outDir, { recursive: true });

        const keyword = options.query ? `${name} ${options.query}` : name;
        console.log(chalk.dim(`搜: ${keyword}`));
        const hits = searchBilibili(keyword, 10);
        if (hits.length === 0) throw new Error('没搜到结果');
        const ranked = rankSongHits(hits);
        const pickIdx = Math.max(1, Number(options.pick ?? 1)) - 1;
        const hit = ranked[Math.min(pickIdx, ranked.length - 1)];
        console.log(chalk.dim(`选中: ${hit.title} (${hit.duration}) — ${hit.author}`));

        console.log(chalk.dim('下载音频…'));
        const src = downloadAudio(hit.url, outDir);

        let vocalSrc = src;
        if (!options.skipSeparate) {
          console.log(chalk.dim('分离人声（demucs）…'));
          const seedVcDir = findSeedVcDir(options.seedVcDir ? String(options.seedVcDir) : undefined);
          const sep = separateVocals(src, joinPath(outDir, 'stems'), seedVcDir);
          if (sep) {
            vocalSrc = sep.vocals;
            console.log(chalk.dim(`人声: ${vocalSrc}`));
          } else {
            console.log(chalk.yellow('人声分离失败（demucs 没装或报错），直接用原音轨——效果会带伴奏'));
          }
        }

        console.log(chalk.dim('换成目标音色…'));
        const res = await convertSingingAuto(vocalSrc, {
          ref: String(options.ref),
          outDir: joinPath(outDir, 'final'),
          diffusionSteps: Number(options.steps) || 35,
        });

        writeFileSync(
          joinPath(outDir, 'meta.json'),
          JSON.stringify({ name, keyword, hit, source: src, vocal: vocalSrc, output: res.outputFile }, null, 2),
          'utf8',
        );

        console.log('');
        console.log(chalk.green('完成'));
        console.log(`  成品: ${res.outputFile}`);
        console.log(`  耗时: ${res.elapsedSec}s`);
        console.log(`  目录: ${outDir}`);
      } catch (error) {
        console.log(chalk.red(`失败: ${(error as Error).message}`));
        process.exitCode = 1;
      }
    });
}
