import { Command } from 'commander';
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join as joinPath, resolve as resolvePath } from 'node:path';
import chalk from 'chalk';
import { findFfmpeg } from '../core/tts.js';

/**
 * `qce sing <source> --ref <参考音色>` —— 歌声音色转换。
 *
 * 用 Seed-VC（零样本 SVC）：
 *   输入一段**有人唱的歌**（干声最好）+ 一段参考音色 → 输出目标音色的唱。
 *
 * 它不是"词曲生成"——旋律来自 source。想凭空作曲得接 MiniMax Music 之类，
 * 然后把结果再喂给这里换音色。
 */

export interface SingOptions {
  ref: string;
  outDir?: string;
  seedVcDir?: string;
  diffusionSteps?: number;
  fp16?: boolean;
  /** 半音移调：换到目标音色的舒适音域 */
  pitchShift?: number;
}

export interface SingResult {
  outputFile: string;
  elapsedSec: number;
}

/** Seed-VC 仓库位置：环境变量优先，其次常见路径 */
export function findSeedVcDir(explicit?: string): string {
  const cands = [
    explicit,
    process.env.QCE_SEEDVC,
    'D:\\github_project\\ZhaoWen_GitHub维护\\_seedvc',
    joinPath(process.cwd(), '_seedvc'),
    joinPath(process.cwd(), '..', '_seedvc'),
  ].filter(Boolean) as string[];
  for (const c of cands) {
    if (existsSync(joinPath(c, 'inference.py'))) return c;
  }
  throw new Error(
    '找不到 Seed-VC（需要 inference.py）。设 QCE_SEEDVC 指向仓库目录。',
  );
}

/** Seed-VC 的 python 解释器 */
export function findSeedVcPython(dir: string): string {
  const cands = [
    joinPath(dir, '.venv', 'Scripts', 'python.exe'),
    joinPath(dir, '.venv', 'bin', 'python'),
    'python',
  ];
  for (const c of cands) {
    if (c === 'python' || existsSync(c)) return c;
  }
  return 'python';
}

/**
 * 跑一次转换。
 *
 * 注意 diffusion-steps：README 建议**歌声转换用 30~50**，
 * 默认 25 是给语音转换的，唱歌用 25 会明显毛躁。
 */
export async function convertSinging(
  source: string,
  options: SingOptions,
): Promise<SingResult> {
  const dir = findSeedVcDir(options.seedVcDir);
  const py = findSeedVcPython(dir);

  const src = resolvePath(source);
  const ref = resolvePath(options.ref);
  if (!existsSync(src)) throw new Error(`源音频不存在: ${src}`);
  if (!existsSync(ref)) throw new Error(`参考音频不存在: ${ref}`);

  const outDir = resolvePath(options.outDir ?? joinPath('output', 'sing', `s-${Date.now()}`));
  mkdirSync(outDir, { recursive: true });

  // 优先用 run_infer.py：它把 torchaudio.save 换成 soundfile。
  // 本机 torch 2.11 的 torchaudio 保存要 torchcodec，而 torchcodec 的 DLL
  // 在 Windows 上加载失败（缺 FFmpeg 共享库）。推理本身没问题，只是落盘那步挂。
  const entry = existsSync(joinPath(dir, 'run_infer.py'))
    ? joinPath(dir, 'run_infer.py')
    : joinPath(dir, 'inference.py');
  const steps = String(options.diffusionSteps ?? 35);
  const args = [
    entry,
    '--source', src,
    '--target', ref,
    '--output', outDir,
    '--diffusion-steps', steps,
  ];
  args.push('--fp16', options.fp16 === false ? 'False' : 'True');
  if (typeof options.pitchShift === 'number' && options.pitchShift !== 0) {
    args.push('--semi-tone-shift', String(options.pitchShift));
  }

  const startedAt = Date.now();
  const r = spawnSync(py, args, {
    cwd: dir,
    encoding: 'utf8',
    timeout: 3_600_000,
    maxBuffer: 64 * 1024 * 1024,
    env: {
      ...process.env,
      // 国内直连 HF 基本不通，统一走镜像
      HF_ENDPOINT: process.env.HF_ENDPOINT ?? 'https://hf-mirror.com',
      // HF 默认缓存在 %USERPROFILE%\.cache —— 低完整性下写不进去，指到项目里
      HF_HOME: process.env.HF_HOME ?? joinPath(dir, '.hf-cache'),
      PYTHONIOENCODING: 'utf-8',
      // 分段后显存反复申请释放，碎片会让后面的段分配失败
      PYTORCH_CUDA_ALLOC_CONF: 'expandable_segments:True',
    },
  });
  const elapsedSec = Math.round((Date.now() - startedAt) / 1000);

  // 不看输出（中文会乱码），直接找产物
  const produced = readdirSync(outDir)
    .filter((f) => /\.(wav|flac|mp3)$/i.test(f))
    .map((f) => ({ f, t: statSync(joinPath(outDir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);

  if (produced.length === 0) {
    const tail = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().split('\n').slice(-6).join('\n');
    throw new Error(`转换没有产出音频。\n${tail}`);
  }

  return { outputFile: joinPath(outDir, produced[0].f), elapsedSec };
}

/**
 * 长音频分段转换。
 *
 * 为什么必须分段：Seed-VC 会**一次性把整段音频装进显存**。
 * 一首 5 分钟的 44.1k 立体声（约 55MB wav）在 8G 卡上直接 CUDA OOM。
 * 分段（默认 20 秒）后每段只占几百 MB，最后拼起来。
 *
 * 拼接用 ffmpeg 的 concat demuxer。段边界可能有轻微接缝，
 * 但对"点歌听听像不像"这个目的足够了。
 */
export async function convertSingingAuto(
  source: string,
  options: SingOptions & { chunkSec?: number },
): Promise<SingResult & { chunks: number }> {
  const dir = findSeedVcDir(options.seedVcDir);
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) throw new Error('找不到 ffmpeg');

  const ffprobe = ffmpeg.replace(/ffmpeg(\.exe)?$/i, (m) => (m.includes('.') ? 'ffprobe.exe' : 'ffprobe'));
  const probe = spawnSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', source], {
    encoding: 'utf8',
  });
  const total = Number((probe.stdout ?? '').trim()) || 0;
  // 10 秒是实测出来的上限：20 秒段在 44.1kHz 下会让 bigvgan 的
  // 激活值撑爆 8G 卡（就算只差 42MB 也分不出来）。
  const chunkSec = Math.max(5, options.chunkSec ?? 10);

  // 短音频直接一次过
  if (total > 0 && total <= chunkSec * 1.4) {
    const r = await convertSinging(source, options);
    return { ...r, chunks: 1 };
  }
  if (total <= 0) throw new Error('读不出音频时长');

  const outDir = resolvePath(options.outDir ?? joinPath('output', 'sing', `s-${Date.now()}`));
  const chunkDir = joinPath(outDir, 'chunks');
  mkdirSync(chunkDir, { recursive: true });

  const n = Math.ceil(total / chunkSec);
  const pieces: string[] = [];
  let elapsed = 0;

  for (let i = 0; i < n; i += 1) {
    const start = i * chunkSec;
    const piece = joinPath(chunkDir, `c${String(i).padStart(3, '0')}.wav`);
    const cut = spawnSync(ffmpeg, [
      '-y', '-v', 'error', '-ss', String(start), '-t', String(chunkSec), '-i', source,
      '-ar', '44100', '-ac', '1', piece,
    ], { timeout: 120_000 });
    if (cut.status !== 0 || !existsSync(piece)) continue;
    const one = await convertSinging(piece, {
      ...options,
      outDir: joinPath(chunkDir, 'conv'),
    });
    elapsed += one.elapsedSec;
    pieces.push(one.outputFile);
  }

  if (pieces.length === 0) throw new Error('分段转换全部失败');

  // 拼接
  const listFile = joinPath(chunkDir, 'list.txt');
  const lines = pieces.map((f) => `file '${f.split(String.fromCharCode(92)).join('/')}'`);
  writeFileSync(listFile, lines.join(String.fromCharCode(10)) + String.fromCharCode(10), 'utf8');
  const finalFile = joinPath(outDir, 'final.wav');
  const cat = spawnSync(ffmpeg, [
    '-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', listFile,
    '-ar', '44100', '-ac', '1', finalFile,
  ], { timeout: 300_000 });
  if (cat.status !== 0 || !existsSync(finalFile)) {
    throw new Error(`拼接失败: ${(cat.stderr ?? '').slice(0, 200)}`);
  }
  return { outputFile: finalFile, elapsedSec: elapsed, chunks: pieces.length };
}

export function singCommand(program: Command): void {
  program
    .command('sing <source>')
    .description('把一首歌的人声换成指定音色（Seed-VC 零样本歌声转换）')
    .requiredOption('-r, --ref <file>', '参考音色音频（1~30 秒，干净单人声）')
    .option('-o, --out-dir <dir>', '输出目录')
    .option('-s, --steps <n>', '扩散步数（歌聲建议 30~50）', '35')
    .option('--seed-vc-dir <dir>', 'Seed-VC 仓库目录')
    .option('--pitch <n>', '半音移调（负数降调）', '0')
    .option('--no-fp16', '关闭半精度（显存够时可以不用）')
    .action(async (source: string, options: Record<string, unknown>) => {
      try {
        console.log(chalk.dim(`源: ${source}`));
        console.log(chalk.dim(`参考音色: ${options.ref}`));
        const r = await convertSingingAuto(source, {
          ref: String(options.ref),
          outDir: options.outDir ? String(options.outDir) : undefined,
          diffusionSteps: Number(options.steps) || 35,
          seedVcDir: options.seedVcDir ? String(options.seedVcDir) : undefined,
          pitchShift: Number(options.pitch) || 0,
          fp16: options.fp16 !== false,
        });
        console.log(chalk.green('完成'));
        console.log(`  音频: ${r.outputFile}`);
        console.log(`  耗时: ${r.elapsedSec}s`);
      } catch (error) {
        console.log(chalk.red(`失败: ${(error as Error).message}`));
        process.exitCode = 1;
      }
    });
}
