import { Command } from 'commander';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
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
  /** 只要逐字稿：不抽帧、只下音频。给"人看的画面"对模型没用，省 token */
  textOnly?: boolean;
  /** 喂给 whisper 的术语提示；缺省从词库自动拼 */
  termPrompt?: string;
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
  /** 逐字稿正文（textOnly 时直接给调用方，不用再读文件） */
  transcriptText?: string;
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

/**
 * 从梗库拼一段术语提示喂给 whisper。
 *
 * 为什么需要：whisper 对同音专有名词很差——实测把「蛆」全认成「屈」，
 * 而一个梗百科视频整期都在讲那个词，认错了等于白转。
 * initial_prompt 会被 whisper 当作「上一段上下文」，能显著拉回这类词。
 *
 * 为什么要截断：prompt 太长反而稀释。whisper 的经验上限在 224 token 左右，
 * 中文按字算的话留 300 字比较稳。
 */
export function buildTermPrompt(maxChars = 300): string {
  const path = joinPath(process.cwd(), 'private', 'knowledge', 'terms.jsonl');
  if (!existsSync(path)) return '';
  let lines: string[];
  try {
    lines = readFileSync(path, 'utf8')
      .split('\n')
      .filter((l) => l.trim() !== '');
  } catch {
    return '';
  }
  const high: string[] = [];
  const rest: string[] = [];
  // 从后往前取：词库是追加写入的，越靠后越新
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (high.length + rest.length >= 160) break;
    try {
      const d = JSON.parse(lines[i]!) as { term?: string; priority?: string };
      const t = String(d.term ?? '').trim();
      const isHigh = d.priority === 'high';
      // 高优先级允许单字（「蛆」这种恰好是单字梗，筛掉就白学了）；
      // 其余仍要求 >=2 字，避免把误收的单字普通词塞进提示
      const minLen = isHigh ? 1 : 2;
      if (t.length < minLen || t.length > 12 || t.includes(' ')) continue;
      // 高优先级（人工整理 / 梗百科逐期）排前面，别被陈年旧梗挤掉
      (isHigh ? high : rest).push(t);
    } catch {
      /* 坏行跳过 */
    }
  }
  const terms = [...high, ...rest];
  let out = '';
  for (const t of terms) {
    if (out.length + t.length + 1 > maxChars) break;
    out += (out ? '、' : '') + t;
  }
  return out;
}

/**
 * 用词库里的 asrFixes 纠正转写结果。
 *
 * 为什么需要：whisper 分不出同音字。「蛆」被稳定认成「区」（实测喂了标题+词库
 * 也没用，因为「区」本身太常见，语言模型压倒性地偏向它）。
 * 但「区」不能全局替换（地区、区别、小区都会被误伤），
 * 所以规则只写**固定搭配**：只改「四区兄弟」「像条区」这种组合。
 *
 * 规则存在词条的 asrFixes 里，形如 [{"from":"四区兄弟","to":"四蛆兄弟"}]。
 * 按 from 长度降序应用，避免短规则先吃掉长规则。
 */
export function applyAsrFixes(text: string): { text: string; hits: number } {
  const path = joinPath(process.cwd(), 'private', 'knowledge', 'terms.jsonl');
  if (!existsSync(path)) return { text, hits: 0 };
  const fixes: Array<{ from: string; to: string }> = [];
  try {
    const raw = readFileSync(path, 'utf8');
    for (const line of raw.split('\n')) {
      if (line.trim() === '') continue;
      try {
        const d = JSON.parse(line) as { asrFixes?: Array<{ from?: string; to?: string }> };
        for (const f of d.asrFixes ?? []) {
          if (f?.from && f?.to) fixes.push({ from: f.from, to: f.to });
        }
      } catch {
        /* 坏行跳过 */
      }
    }
  } catch {
    return { text, hits: 0 };
  }
  fixes.sort((a, b) => b.from.length - a.from.length);
  let out = text;
  let hits = 0;
  for (const f of fixes) {
    if (!out.includes(f.from)) continue;
    hits += out.split(f.from).length - 1;
    out = out.split(f.from).join(f.to);
  }
  return { text: out, hits };
}

/** 调用户的 AudioTranscriber 转写音频（有就调，没有就跳过） */
export function transcribeWithLocalTool(
  transcriberDir: string,
  audioFile: string,
  model = 'small',
  initialPrompt = '',
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
  const cmdArgs = [script, audioFile, '--model', model, '--language', 'zh', '--device', 'cpu'];
  // 术语提示：把词库里的专有名词喂给 whisper，同音错认（蛆→屈）大幅减少
  if (initialPrompt.trim() !== '') cmdArgs.push('--initial-prompt', initialPrompt.trim());
  spawnSync(py, cmdArgs, {
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
    if (options.textOnly) {
      // 只要文字：直接抽音频，不下视频。
      // 一个 10 分钟的视频从 ~50MB 降到 ~5MB，还省掉抽帧那步。
      const dl = runYtDlp(
        ytdlp,
        // 不加 -x：那是"转码成 wav"，要 yt-dlp 自己找 ffmpeg，而本机 ffmpeg 在
        // thirdparty 里不在 PATH，会报 "ffprobe and ffmpeg not found"。
        // 直接下原始音频流，转 16k 单声道那步交给下面的 ffmpeg（它用的是绝对路径）。
        ['-f', 'bestaudio/best', '--no-warnings',
         '-o', joinPath(outDir, 'audio.%(ext)s'), source],
        tempDir,
        900_000,
      );
      if (!dl.ok) throw new Error(`下载音频失败: ${dl.out.slice(-300)}`);
      const gotAudio = readdirSync(outDir).filter((f) => f.startsWith('audio.'));
      if (gotAudio.length === 0) throw new Error('下载完成但没找到音频文件');
      mediaFile = joinPath(outDir, gotAudio[0]);
    } else {
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
    }
  } else {
    mediaFile = resolvePath(source);
    if (!existsSync(mediaFile)) throw new Error(`文件不存在: ${mediaFile}`);
  }

  if (!durationSec) durationSec = ffprobeDuration(ffprobe, mediaFile);
  if (!durationSec) throw new Error('拿不到视频时长');

  // 3) 抽帧 + 拼图（textOnly 时整段跳过：这些图对模型没用，只烧 token）
  let frameFiles: string[] = [];
  if (!options.textOnly) {
    const frameCount = options.frames ?? 12;
    const framesDir = joinPath(outDir, 'frames');
    frameFiles = extractFrames(ffmpeg, mediaFile, framesDir, durationSec, frameCount);
    const sheetPath = joinPath(outDir, 'sheet.png');
    buildContactSheet(frameFiles, sheetPath, durationSec);
  }

  // 4) 转写（可选，默认开；textOnly 时是唯一产物，必须有）
  let transcriptPath = '';
  let transcriptText: string | undefined;
  const needTranscript = options.transcribe !== false || options.textOnly === true;
  if (needTranscript) {
    const transcriberDir = options.transcriberDir
      ?? process.env.QCE_TRANSCRIBER
      ?? 'D:\\github_project\\ZhaoWen_GitHub维护\\AudioTranscriber';
    if (!existsSync(transcriberDir) && options.textOnly) {
      throw new Error(`text-only 模式需要转写器，但没找到: ${transcriberDir}（用 --transcriber-dir 指定）`);
    }
    if (existsSync(transcriberDir)) {
      // 从媒体里抽出单声道 16k 音频再转写，比让 whisper 自己解码稳
      const audioFile = joinPath(outDir, 'audio.wav');
      spawnSync(ffmpeg, ['-y', '-v', 'error', '-i', mediaFile, '-vn', '-ar', '16000', '-ac', '1', audioFile], {
        timeout: 300_000,
      });
      if (existsSync(audioFile)) {
        // 提示词 = 视频标题 + 词库术语。
        // 只给词库不够：实测「蛆」这种单字梗，whisper 会稳定写成更常见的「区」。
        // 但梗百科这类视频的标题本身就写着「蛆是什么梗」，把标题喂进去等于直接点名。
        const autoPrompt = options.termPrompt ?? [title, buildTermPrompt()].filter(Boolean).join('。');
        const tr = transcribeWithLocalTool(transcriberDir, audioFile, options.model ?? 'small', autoPrompt);
        if (tr.ok) {
          transcriptPath = tr.transcriptPath;
          try {
            transcriptText = readFileSync(transcriptPath, 'utf8');
            // 同音字纠正（规则来自词库，只改固定搭配）
            const fixed = applyAsrFixes(transcriptText);
            if (fixed.hits > 0) {
              transcriptText = fixed.text;
              writeFileSync(transcriptPath, fixed.text, 'utf8');
            }
          } catch {
            /* 读不到就只给路径 */
          }
        }
      }
    }
  }

  if (!options.keepMedia && mediaFile.startsWith(outDir)) {
    // 媒体留在 outDir 里，方便复看；不主动删
  }

  return { title, durationSec, uploader, mediaFile, frameFiles, transcriptPath, transcriptText, outDir };
}

export function videoCommand(program: Command): void {
  program
    .command('video <source>')
    .description('看视频：下载（或读本地文件）→ 抽帧拼图 → 转写，一次出齐')
    .option('-n, --frames <n>', '抽多少帧', '12')
    .option('-o, --out-dir <dir>', '输出目录')
    .option('--no-transcribe', '不转写，只要帧')
    .option('--text-only', '只要逐字稿：不抽帧、只下音频（省 token）', false)
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
          textOnly: options.textOnly === true,
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
        if (options.textOnly === true) {
          if (r.transcriptText) {
            console.log('');
            console.log(chalk.bold('── 逐字稿 ──'));
            console.log(r.transcriptText.trim());
          } else {
            console.log(chalk.dim('  逐字稿为空（没转出内容）'));
          }
        }
        if (r.transcriptPath) {
          console.log('');
          console.log(`  逐字稿文件: ${r.transcriptPath}`);
        } else if (options.transcribe !== false && !options.info) {
          console.log(chalk.dim('  逐字稿: 未生成（没找到 AudioTranscriber，或转写失败）'));
        }
      } catch (error) {
        console.log(chalk.red(`失败: ${(error as Error).message}`));
        process.exitCode = 1;
      }
    });

  // ── watch：给"只想看说了什么"的场景用的入口，默认不抽帧 ────────────────
  //
  // 为什么不直接把 video 的默认改掉：video 的卖点是"画面也有了"，
  // 那是另一类需求（看动作、看画面里的字）。这里单独开一个口子，
  // 默认只给逐字稿，需要画面时加 --frames 就回到抽帧模式。
  program
    .command('watch [source]')
    .description('看视频（默认只要逐字稿）：只下音频 → 转写 → 打印文字。加 --frames 才抽帧')
    .option('-n, --frames <n>', '抽多少帧（给了就切回普通模式）')
    .option('-o, --out-dir <dir>', '输出目录')
    .option('--model <name>', 'whisper 模型（默认 small；本机只缓存了 small / large-v3）', 'small')
    .option('--transcriber-dir <dir>', 'AudioTranscriber 所在目录')
    .option('--info', '只取元数据，不下载')
    .action(async (source: string | undefined, options: Record<string, unknown>) => {
      if (!source) {
        console.log(chalk.dim('用法: qce watch <视频链接或本地文件> [--frames 12]'));
        return;
      }
      const wantFrames = options.frames !== undefined;
      try {
        console.log(chalk.dim(`看: ${source}${wantFrames ? '' : '（只取文字）'}`));
        const r = await watchVideo(source, {
          textOnly: !wantFrames,
          ...(wantFrames ? { frames: Number(options.frames) || 12 } : {}),
          outDir: options.outDir ? String(options.outDir) : undefined,
          model: options.model ? String(options.model) : 'small',
          transcriberDir: options.transcriberDir ? String(options.transcriberDir) : undefined,
          infoOnly: options.info === true,
        });
        console.log('');
        console.log(chalk.bold(r.title));
        console.log(`  时长: ${mmss(r.durationSec)}${r.uploader ? ` | UP: ${r.uploader}` : ''}`);
        if (r.transcriptText) {
          console.log('');
          console.log(chalk.bold('── 逐字稿 ──'));
          console.log(r.transcriptText.trim());
        } else if (!options.info) {
          console.log(chalk.dim('  没拿到逐字稿'));
        }
        if (r.transcriptPath) console.log(`
  文件: ${r.transcriptPath}`);
      } catch (error) {
        console.log(chalk.red(`失败: ${(error as Error).message}`));
        process.exitCode = 1;
      }
    });
}
