/**
 * `qce face peek`：把群/私聊里的一张图弄明白。
 *
 * 一条命令做完四件事：
 *   1. 定位消息里的图（按 message_id，或取群里最新一张）
 *   2. 拿到本地文件（OneBot get_image）
 *   3. 动图抽帧拼成一张对比图（单帧看不出动作，奶龙那次就吃过亏）
 *   4. 交给统一识图模块（千问优先、本地兜底）出「文字 + 情绪 + 角色」
 *
 * 为什么做成命令而不是每次临时写脚本：这个流程一天要跑好几次，
 * 而且抽帧那几个坑（动图 vs 静图、扩展名不可信、单帧误判）每次都重踩。
 */
import { Command } from 'commander';
import chalk from 'chalk';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { authManager } from '../core/auth.js';
import { understandImageBuffer } from '../core/vision.js';

export const FACE_TMP_DIR = join(process.cwd(), 'output', 'peek');

/** 按魔数判断真实格式（QQ 的扩展名经常是错的，.jpg 里放 GIF 很常见） */
function sniffFormat(buf: Buffer): 'png' | 'jpg' | 'gif' | 'webp' | 'unknown' {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50) return 'png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8) return 'jpg';
  if (buf.length >= 6 && buf.slice(0, 3).toString('ascii') === 'GIF') return 'gif';
  if (buf.length >= 12 && buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return 'webp';
  return 'unknown';
}

/**
 * 抽帧拼成一张横向对比图。
 *
 * 为什么要拼图而不是只截第一帧：动图的意思常常在动作里。
 * 之前把奶龙的震惊图只看第一帧，认成了"黄色怪鱼"。
 * 拼 4 帧既能看到动作走向，又只需一次识图调用。
 */
function buildSheet(
  srcPath: string,
  outPath: string,
  frameCount: number,
): { frames: number; size: [number, number]; picked: number[] } {
  const py = `
import json, sys
from PIL import Image

src, out, want = sys.argv[1], sys.argv[2], int(sys.argv[3])
im = Image.open(src)
total = getattr(im, 'n_frames', 1)
size = im.size

if total <= 1:
    picked = [0]
else:
    want = max(2, min(want, total))
    # 均匀取样，含首尾（首尾往往代表动作的两端）
    picked = sorted({round(i * (total - 1) / (want - 1)) for i in range(want)})

tile = 256
sheet = Image.new('RGB', (tile * len(picked), tile), 'white')
for k, i in enumerate(picked):
    im.seek(i)
    f = im.convert('RGB')
    # 按长边缩放后居中贴到方块里，避免变形
    w, h = f.size
    s = tile / max(w, h)
    f = f.resize((max(1, int(w * s)), max(1, int(h * s))))
    sheet.paste(f, (tile * k + (tile - f.size[0]) // 2, (tile - f.size[1]) // 2))

sheet.save(out)
print(json.dumps({"frames": total, "size": list(size), "picked": picked}))
`;
  const r = spawnSync('python', ['-c', py, srcPath, outPath, String(frameCount)], {
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (r.status !== 0) {
    throw new Error(`抽帧失败: ${(r.stderr ?? '').slice(0, 200)}`);
  }
  return JSON.parse(r.stdout.trim());
}

export const facePeekCommand = new Command('peek')
  .description('弄明白一张图：取图 + 动图抽帧拼图 + 千问识图（一步到位）')
  .argument('[messageId]', '消息 ID（省略则配合 --group 取最新一张）')
  .option('-g, --group <gid>', '从这个群取最新一张图')
  .option('-n, --frames <n>', '动图抽几帧拼图', '4')
  .option('--keep', '保留临时文件（默认保留，方便人工复核）')
  .option('--json', '输出 JSON')
  .action(async (messageId, options) => {
    mkdirSync(FACE_TMP_DIR, { recursive: true });

    let client;
    try {
      client = authManager.getClient();
    } catch (error) {
      console.log(chalk.red(`OneBot 未连接: ${(error as Error).message}`));
      return;
    }

    // ————— 1. 定位图片段 —————
    let imageFile = '';
    let from = '';
    try {
      if (messageId) {
        const msg: any = await client.getMessage(Number(messageId));
        const seg = (msg?.message ?? []).find((s: any) => s.type === 'image');
        if (!seg) {
          console.log(chalk.yellow('这条消息里没有图片'));
          return;
        }
        imageFile = String(seg.data?.file ?? '');
        from = `message ${messageId}`;
      } else if (options.group) {
        // 注意签名是 (groupId, messageSeq?, count) —— 别把 count 传成第二个参数
        const hist: any = await client.getGroupMsgHistory(Number(options.group), undefined, 20);
        const msgs = (hist?.messages ?? []).slice().reverse();
        for (const m of msgs) {
          const seg = (m.message ?? []).find((s: any) => s.type === 'image');
          if (seg) {
            imageFile = String(seg.data?.file ?? '');
            from = `群 ${options.group} 最新一张`;
            break;
          }
        }
        if (!imageFile) {
          console.log(chalk.yellow('这个群最近 20 条里没有图片'));
          return;
        }
      } else {
        console.log(chalk.red('用法：qce face peek <messageId>  或  qce face peek --group <群号>'));
        return;
      }
    } catch (error) {
      console.log(chalk.red(`取消息失败: ${(error as Error).message}`));
      return;
    }

    if (!imageFile) {
      console.log(chalk.yellow('拿不到图片文件名'));
      return;
    }

    // ————— 2. 拿本地文件 —————
    // getImage 返回的字段名在不同 NapCat 版本里不一样，两个都试
    let localPath = '';
    try {
      const info: any = await client.getImage(imageFile);
      localPath = String(info?.file ?? info?.filename ?? '');
    } catch (error) {
      console.log(chalk.red(`取图失败: ${(error as Error).message}`));
      return;
    }
    if (!localPath || !existsSync(localPath)) {
      console.log(chalk.yellow(`图片没落到本地（${localPath || '空路径'}）——可能是 QQ 内置表情，客户端渲染的拿不到像素`));
      return;
    }

    const raw = readFileSync(localPath);
    const fmt = sniffFormat(raw);
    const stamp = Date.now();
    const sheetPath = join(FACE_TMP_DIR, `sheet-${stamp}.png`);

    // ————— 3. 抽帧拼图 —————
    let meta: { frames: number; size: [number, number]; picked: number[] };
    try {
      meta = buildSheet(localPath, sheetPath, Number(options.frames) || 4);
    } catch (error) {
      console.log(chalk.red(String((error as Error).message)));
      return;
    }

    // ————— 4. 识图 —————
    const sheetBuf = readFileSync(sheetPath);
    let desc;
    try {
      desc = await understandImageBuffer(sheetBuf, { timeoutMs: 90_000 });
    } catch (error) {
      console.log(chalk.red(`识图失败: ${(error as Error).message}`));
      return;
    }

    const result = {
      from,
      file: localPath,
      format: fmt,
      bytes: raw.length,
      frames: meta.frames,
      size: meta.size,
      picked: meta.picked,
      sheet: sheetPath,
      text: desc.text,
      emotion: desc.emotion,
      character: desc.character,
      source: desc.source,
    };

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    const animatedNote = meta.frames > 1 ? `动图 ${meta.frames} 帧，抽 ${meta.picked.length} 帧` : '静图';
    console.log(chalk.dim(`来源: ${from}`));
    console.log(chalk.dim(`文件: ${localPath}`));
    console.log(chalk.dim(`格式: ${fmt} | ${(raw.length / 1024).toFixed(0)}KB | ${meta.size[0]}×${meta.size[1]} | ${animatedNote}`));
    console.log(chalk.dim(`拼图: ${sheetPath}`));
    console.log('');
    if (result.text) console.log(`${chalk.cyan('图里的字')}  ${result.text}`);
    if (result.emotion) console.log(`${chalk.cyan('情绪/场景')}  ${result.emotion}`);
    if (result.character) console.log(`${chalk.cyan('角色')}  ${result.character}`);
    console.log(chalk.dim(`（识图来源: ${result.source}）`));

    if (meta.size[0] <= 64 || meta.size[1] <= 64) {
      console.log('');
      console.log(chalk.yellow(`⚠ 只有 ${meta.size[0]}×${meta.size[1]}，可能只是缩略图，细节可能认不准`));
    }
  });
