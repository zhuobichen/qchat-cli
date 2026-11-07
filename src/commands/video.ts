import { Command } from 'commander';
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, join as joinPath, resolve as resolvePath } from 'node:path';
import chalk from 'chalk';

import { findFfmpeg } from '../core/tts.js';

/**
 * `qce video <url|file>` —— 看视频。
 *
 * 为什么要自己做而不用现成的 watch skill：
 *   那个 skill 的 `watch.py` 在 B 站链接上会挂死（实测 8 小时无输出）。
 *   这条路每一步都能看见、能单跑、失败知道失败在哪。
 *
 * 三步：
 *   1. yt-dlp 取元数据 + 下载（只下 360p，看内容够用）
 *   2. ffmpeg 按间隔抽帧 → 拼成一张图
 *   3. 可选：音频交给 AudioTranscriber 转写（带时间戳）
 */

export interface VideoOptions {
  frames?: number;
  outDir?: string;
  transcribe?: boolean;
  transcriberDir?: string;
  model?: string;
  keepMedia?: boolean;
  /** 只取元数据，不下载 */
  infoOnly?: boolean;
}

/** yt-dlp 可执行文件：优先环境变量，其次 thirdparty，最后 PATH */
export function findYtDlp(): string {
  const env = process.env.QCE_YTDLP;
  if (env && existsSync(env)) return env;
  const candidates = [
    joinPath(process.cwd(), 'thirdparty', 'yt-dlp', 'yt-dlp.exe'),
    joinPath(process.cwd(), '..', 'thirdparty', 'yt-dlp', 'yt-dlp.exe'),
    'D:\\github_project\\ZhaoWen_GitHub维护\\thirdparty\\yt-dlp\\yt-dlp.exe',
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return 'yt-dlp';
}

/**
 * 给 PyInstaller 打包的 exe（yt-dlp 就是）准备一个**全新**的可写临时目录。
 *
 * 踩过的坑：用已存在的目录（哪怕可写）会报
 *   [PYI-xxxx:ERROR] Could not create temporary directory!
 * 因为 bootloader 会往固定名前缀里解包，残留就冲突。
 * 每次新建一个唯一子目录最稳。
 */
export function makeTempDir(base: string, tag: string): string {
  const dir = joinPath(base, `.tmp-${tag}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function runYtDlp(
  ytdlp: string,
  args: string[],
  tempDir: string,
  timeoutMs = 600_000,
): { ok: boolean; out: string } {
  const r = spawnSync(ytdlp, args, {
    encoding: 'utf8',
    timeout: timeoutMs,
    env: { ...process.env, TEMP: tempDir, TMP: tempDir },
    maxBuffer: 32 * 1024 * 1024,
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
  return { ok: r.status === 0, out };
}

function ffprobeDuration(ffprobe: string, file: string): number {
  const r = spawnSync(ffprobe, [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file,
  ], { encoding: 'utf8' });
  const n = Number((r.stdout ?? '').trim());
  return Number.isFinite(n) ? n : 0;
}

function mmss(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export interface VideoResult {
  title: string;
  durationSec: number;
  uploader: string;
  mediaFile: string;
  frameFiles: string[];
  transcriptPath: string;
  outDir: string;
}

/** 抽帧：按均匀间隔，首帧从 0 开始 */
export function extractFrames(
  ffmpeg: string,
  media: string,
  framesDir: string,
  durationSec: number,
  count: number,
): string[] {
  mkdirSync(framesDir, { recursive: true });
  const interval = Math.max(1, durationSec / count);
  const r = spawnSync(ffmpeg, [
    '-y', '-v', 'error', '-i', media,
    '-vf', `fps=1/${interval.toFixed(3)},scale=640:-1`,
    '-q:v', '3',
    joinPath(framesDir, 'f%03d.jpg'),
  ], { encoding: 'utf8', timeout: 300_000 });
  if (r.status !== 0) {
    throw new Error(`抽帧失败: ${(r.stderr ?? '').slice(0, 300)}`);
  }
  return readdirSync(framesDir)
    .filter((f) => f.endsWith('.jpg'))
    .sort()
    .map((f) => joinPath(framesDir, f));
}

/**
 * 把帧拼成一张联系表（contact sheet）。
 * 用 Python + Pillow：纯 Node 拼图得引依赖，而机器上已经有 Pillow。
 */
export function buildContactSheet(
  frameFiles: string[],
  outPath: string,
  durationSec: number,
  python = 'python',
): boolean {
  if (frameFiles.length === 0) return false;
  const scriptPath = outPath.replace(/\.png$/i, '.sheet.py');
  const cols = frameFiles.length <= 4 ? 2 : frameFiles.length <= 9 ? 3 : 4;
  const script = `
import sys
from PIL import Image, ImageDraw
files = ${JSON.stringify(frameFiles)}
cols = ${cols}
dur = ${durationSec}
w, h = 400, 300
rows = (len(files) + cols - 1) // cols
sheet = Image.new('RGB', (cols * w, rows * int(h * 0.78)), 'white')
d = ImageDraw.Draw(sheet)
for i, f in enumerate(files):
    im = Image.open(f).convert('RGB')
    im.thumbnail((w, int(h * 0.75)))
    x, y = (i % cols) * w, (i // cols) * int(h * 0.78)
    sheet.paste(im, (x, y))
    ts = int(dur * i / max(1, len(files)))
    d.text((x + 4, y + im.size[1] + 2), '%d:%02d' % (ts // 60, ts % 60), fill='black')
sheet.save(${JSON.stringify(outPath)})
print('sheet', sheet.size)
`;
  writeFileSync(scriptPath, script, 'utf8');
  const r = spawnSync(python, [scriptPath], { encoding: 'utf8', timeout: 180_000 });
  return r.status === 0 && existsSync(outPath);
}

/** 调用户的 AudioTranscriber 转写音频（有就调，没有就跳过） */
export function transcribeWithLocalTool(
  transcriberDir: string,
  audioFile: string,
  model = 'small',
): { ok: boolean; transcriptPath: string; message: string } {
  const py = joinPath(transcriberDir, '.venv', 'Scripts', 'python.exe');
  const script = joinPath(transcriberDir, 'transcribe.py');
  if (!existsSync(py) || !existsSync(script)) {
    return { ok: false, transcriptPath: '', message: '没找到 AudioTranscriber（缺 .venv 或 transcribe.py）' };
  }
  // 记开始时间去"找"结果，而不是去"读"它的输出。
  // 踩过的坑：子进程的中文输出按控制台代码页编码，我们按 utf8 解是乱码，
  // 路径里的中文全废，existsSync 必然失败——于是明明转写成功了却报"失败"。
  const startedAt = Date.now() - 1000;
  const outRoot = joinPath(transcriberDir, 'output');
  spawnSync(py, [script, audioFile, '--model', model, '--language', 'zh', '--device', 'cpu'], {
    encoding: 'utf8',
    cwd: transcriberDir,
    timeout: 1_800_000,
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });

  if (!existsSync(outRoot)) {
    return { ok: false, transcriptPath: '', message: '转写输出目录不存在' };
  }
  let best = '';
  let bestTime = 0;
  for (const name of readdirSync(outRoot)) {
    const dir = joinPath(outRoot, name);
    const md = joinPath(dir, '完整逐字稿.md');
    if (!existsSync(md)) continue;
    const t = statSync(dir).mtimeMs;
    if (t >= startedAt && t > bestTime) {
      bestTime = t;
      best = md;
    }
  }
  if (best) return { ok: true, transcriptPath: best, message: '' };
  return { ok: false, transcriptPath: '', message: '转写跑完但没找到新的逐字稿' };
}

export async function watchVideo(
  source: string,
  options: VideoOptions = {},
): Promise<VideoResult> {
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) throw new Error('找不到 ffmpeg（可设 QCE_FFMPEG）');
  const ffprobe = ffmpeg.replace(/ffmpeg(\.exe)?$/i, (m) => (m.includes('.') ? 'ffprobe.exe' : 'ffprobe'));
  const ytdlp = findYtDlp();

  const outDir = resolvePath(options.outDir ?? joinPath('output', 'video', `v-${Date.now()}`));
  mkdirSync(outDir, { recursive: true });
  const tempDir = makeTempDir(joinPath(process.cwd(), '.tmp-ytdlp'), 'video');

  let mediaFile = '';
  let title = basename(source);
  let uploader = '';
  let durationSec = 0;

  const isUrl = /^https?:\/\//i.test(source);
  if (isUrl) {
    // 1) 元数据
    const meta = runYtDlp(
      ytdlp,
      ['--no-warnings', '--skip-download', '--print', '%(title)s\t%(duration)s\t%(uploader)s', source],
      tempDir,
      120_000,
    );
    if (meta.ok && meta.out) {
      const [t, d, u] = meta.out.split('\n').pop()!.split('\t');
      title = t ?? title;
      durationSec = Number(d) || 0;
      uploader = u ?? '';
    } else {
      throw new Error(`取元数据失败: ${meta.out.slice(0, 300)}`);
    }
    if (options.infoOnly) {
      return { title, durationSec, uploader, mediaFile: '', frameFiles: [], transcriptPath: '', outDir };
    }
    // 2) 下载：只取 360p，看内容够用，省时间
    const dl = runYtDlp(
      ytdlp,
      ['-f', '30016+30216/30016/best[height<=360]/best', '--no-warnings',
       '--merge-output-format', 'mp4', '-o', joinPath(outDir, 'media.%(ext)s'), source],
      tempDir,
      900_000,
    );
    if (!dl.ok) throw new Error(`下载失败: ${dl.out.slice(-300)}`);
    const got = readdirSync(outDir).filter((f) => f.startsWith('media.'));
    if (got.length === 0) throw new Error('下载完成但没找到媒体文件');
    mediaFile = joinPath(outDir, got[0]);
  } else {
    mediaFile = resolvePath(source);
    if (!existsSync(mediaFile)) throw new Error(`文件不存在: ${mediaFile}`);
  }

  if (!durationSec) durationSec = ffprobeDuration(ffprobe, mediaFile);
  if (!durationSec) throw new Error('拿不到视频时长');

  // 3) 抽帧 + 拼图
  const frameCount = options.frames ?? 12;
  const framesDir = joinPath(outDir, 'frames');
  const frameFiles = extractFrames(ffmpeg, mediaFile, framesDir, durationSec, frameCount);
  const sheetPath = joinPath(outDir, 'sheet.png');
  buildContactSheet(frameFiles, sheetPath, durationSec);

  // 4) 转写（可选，默认开）
  let transcriptPath = '';
  if (options.transcribe !== false) {
    const transcriberDir = options.transcriberDir
      ?? process.env.QCE_TRANSCRIBER
      ?? 'D:\\github_project\\ZhaoWen_GitHub维护\\AudioTranscriber';
    if (existsSync(transcriberDir)) {
      // 从媒体里抽出单声道 16k 音频再转写，比让 whisper 自己解码稳
      const audioFile = joinPath(outDir, 'audio.wav');
      spawnSync(ffmpeg, ['-y', '-v', 'error', '-i', mediaFile, '-vn', '-ar', '16000', '-ac', '1', audioFile], {
        timeout: 300_000,
      });
      if (existsSync(audioFile)) {
        const tr = transcribeWithLocalTool(transcriberDir, audioFile, options.model ?? 'small');
        if (tr.ok) transcriptPath = tr.transcriptPath;
      }
    }
  }

  if (!options.keepMedia && mediaFile.startsWith(outDir)) {
    // 媒体留在 outDir 里，方便复看；不主动删
  }

  return { title, durationSec, uploader, mediaFile, frameFiles, transcriptPath, outDir };
}

export function videoCommand(program: Command): void {
  program
    .command('video <source>')
    .description('看视频：下载（或读本地文件）→ 抽帧拼图 → 转写，一次出齐')
    .option('-n, --frames <n>', '抽多少帧', '12')
    .option('-o, --out-dir <dir>', '输出目录')
    .option('--no-transcribe', '不转写，只要帧')
    .option('--model <name>', 'whisper 模型（tiny/base/small/medium/large-v3）', 'small')
    .option('--transcriber-dir <dir>', 'AudioTranscriber 所在目录')
    .option('--info', '只取元数据，不下载')
    .action(async (source: string, options: Record<string, unknown>) => {
      try {
        console.log(chalk.dim(`看: ${source}`));
        const r = await watchVideo(source, {
          frames: Number(options.frames) || 12,
          outDir: options.outDir ? String(options.outDir) : undefined,
          transcribe: options.transcribe !== false,
          model: options.model ? String(options.model) : 'small',
          transcriberDir: options.transcriberDir ? String(options.transcriberDir) : undefined,
          infoOnly: options.info === true,
        });
        console.log('');
        console.log(chalk.bold(r.title));
        console.log(`  时长: ${mmss(r.durationSec)}${r.uploader ? ` | UP: ${r.uploader}` : ''}`);
        console.log(`  输出: ${r.outDir}`);
        if (r.frameFiles.length) {
          console.log(`  帧: ${r.frameFiles.length} 张 → ${joinPath(r.outDir, 'sheet.png')}`);
        }
        if (r.transcriptPath) {
          console.log(`  逐字稿: ${r.transcriptPath}`);
        } else if (options.transcribe !== false && !options.info) {
          console.log(chalk.dim('  逐字稿: 未生成（没找到 AudioTranscriber，或转写失败）'));
        }
      } catch (error) {
        console.log(chalk.red(`失败: ${(error as Error).message}`));
        process.exitCode = 1;
      }
    });
}
