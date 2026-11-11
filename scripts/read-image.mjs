#!/usr/bin/env node
/**
 * 看图分流：纯文字截图走本地 OCR，带画面的走千问视觉。
 *
 * 为什么要分流：OCR 是纯本地、几百毫秒、不花钱，但它"看不见画面"——
 * 一张表情包它能刮出一个「O」然后就没了。千问视觉 2-3 秒、要网、要额度，
 * 但它能说出"黄乎乎小怪兽一脸懵逼"。
 * 所以判据是「这张图里到底有没有画」。
 *
 * 判定方法：把图缩到 320 宽、二值化，看**颜色种类**和**边缘密度**。
 *   - 截图/文档：几乎全是白底黑字，颜色极少，边缘细而密集
 *   - 表情包/照片：颜色多，块状色阶，边缘粗
 *
 * 用法：
 *   node scripts/read-image.mjs output/x.jpg
 *   node scripts/read-image.mjs output/x.gif --ask "这图啥梗"
 *   node scripts/read-image.mjs output/x.jpg --force-ocr / --force-vision
 *   node scripts/read-image.mjs output/x.jpg --json
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const argv = process.argv.slice(2);
const target = argv.find((a) => !a.startsWith('--') && !['--ask', '--json'].includes(a));
const arg = (n, d) => {
  const i = argv.indexOf('--' + n);
  return i >= 0 ? argv[i + 1] : d;
};
const flag = (n) => argv.includes('--' + n);

if (!target) {
  console.log('用法: node scripts/read-image.mjs <图片> [--ask "想问什么"] [--force-ocr|--force-vision] [--json]');
  process.exit(1);
}

const abs = path.resolve(ROOT, target);
if (!fs.existsSync(abs)) {
  console.log('文件不存在: ' + abs);
  process.exit(1);
}

/**
 * 判据：这图里"有没有画"。
 * 返回 { kind: 'text'|'picture', colors, edgeRatio, inkRatio }
 */
function classify(file) {
  const py = `
import sys, json
from PIL import Image
import numpy as np

p = r"${file.replace(/\\/g, '\\\\')}"
im = Image.open(p)
try:
    im.seek(0)
except Exception:
    pass
im = im.convert('RGB')
w, h = im.size
# 缩到 320 宽，够判类型又不费时
if w > 320:
    im = im.resize((320, max(1, int(h * 320 / w))), Image.NEAREST)
a = np.asarray(im).astype(np.int16)

# 判据核心：前 5 种颜色的覆盖率 + 首色覆盖率。
# 实测（2026-11-11）：
#   文字截图   前5占 0.93 / 首色 0.81   ← 白底 + 黑字，颜色高度集中
#   表情包     前5占 0.47 / 首色 0.15
#   插画       前5占 0.55 / 首色 0.27
#   Q 版角色   前5占 0.27 / 首色 0.06
# 早期用"颜色种类数"判，带缩略图的公众号截图直接判反（颜色 148 种，但它就是文字图）。
flat = (a // 24).reshape(-1, 3)
keys, cnt = np.unique(flat, axis=0, return_counts=True)
order = np.argsort(-cnt)
top5 = float(cnt[order[:5]].sum() / len(flat))
top1 = float(cnt[order[0]] / len(flat))

g = np.asarray(im.convert('L')).astype(np.float32)
ink = float((g < 110).sum() / g.size)

print(json.dumps({'colorKinds': int(len(keys)), 'top5': round(top5, 3), 'top1': round(top1, 3), 'inkRatio': round(ink, 3)}))
`;
  const r = spawnSync('python', ['-c', py], { encoding: 'utf8', timeout: 30000 });
  if (r.status !== 0) return null;
  try {
    return JSON.parse(r.stdout.trim());
  } catch {
    return null;
  }
}

function decide(stats) {
  if (!stats) return 'vision'; // 判不出来就交给视觉，别漏
  // 白底黑字：颜色高度集中（前 5 种就吃掉大半屏），且墨色极少
  if (stats.top5 >= 0.7 && stats.top1 >= 0.5) return 'text';
  return 'vision';
}

const stats = classify(abs);
let route = flag('force-ocr') ? 'text' : flag('force-vision') ? 'vision' : decide(stats);
const wantJson = flag('json');
const ask = arg('ask', '');

let out;
if (route === 'text') {
  // ⚠️ ocr.py 是 Python，不能再拿 process.execPath（node）去跑它
  //
  // 编码坑（2026-11-11 踩的）：Python 在 Windows 上往管道输出时按 locale 编码
  // （cp936/GBK）写字节，Node 这边按 UTF-8 解，中文全变乱码
  // ——「ʶ�� 3 �У�」那种，而且它长得"像有内容"，会一路被当成图片描述发进群。
  // 两个都设：PYTHONIOENCODING 管 Python 自己，-X utf8 兜底子进程。
  const r = spawnSync('python', ['-X', 'utf8', path.join(ROOT, 'scripts', 'ocr.py'), abs], {
    encoding: 'utf8',
    timeout: 180000,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
  });
  out = ((r.stdout || '') + (r.stderr || '')).trim();
  // OCR 出空或者只有一两个字符 → 说明这图根本没字，改走视觉
  const chars = out.replace(/识别到\s*\d+\s*行：?/, '').replace(/\s/g, '');
  if (!flag('force-ocr') && chars.length <= 2) {
    route = 'vision';
  }
}

if (route === 'vision') {
  const args = [path.join(ROOT, 'scripts', 'see.mjs'), abs];
  if (ask) args.push('--ask', ask);
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 120000 });
  out = ((r.stdout || '') + (r.stderr || '')).trim();
}

if (wantJson) {
  console.log(JSON.stringify({ route, stats, text: out }, null, 2));
} else {
  if (stats) {
    // 这行给调试用，正常回复时不用它
    if (process.env.READ_IMAGE_DEBUG) {
      console.log(`[路由: ${route}  前5占${stats.top5} 首色${stats.top1} 墨${stats.inkRatio}]\n`);
    }
  }
  console.log(out);
}
