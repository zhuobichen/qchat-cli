// 用法: node render.cjs <场景名 s22_egypt|s23_wheat|s24_bridge> <帧目录> [帧号,逗号分隔(0起)]
// 每帧 t=f/30 调 scene.draw(ctx, t, t)，写 0001.png..0240.png，再用 <skill>/scripts/deliver.py 编码。
const fs = require('fs'), path = require('path');
const { createCanvas, load } = require('./env.cjs');
const id = process.argv[2], out = process.argv[3];
const frames = process.argv[4] ? process.argv[4].split(',').map(Number) : Array.from({ length: 240 }, (_, i) => i);
load('scenes/' + id + '.js');
const scene = SCENES[id]; if (scene.init) scene.init({});
const cv = createCanvas(1920, 1080), ctx = cv.getContext('2d');
fs.mkdirSync(out, { recursive: true });
const t0 = Date.now();
for (const f of frames) {
  const t = f / 30;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, 1920, 1080);
  scene.draw(ctx, t, t);
  fs.writeFileSync(path.join(out, String(f + 1).padStart(4, '0') + '.png'), cv.toBuffer('image/png'));
  if (f % 30 === 0) console.log(id, 'frame', f, ((Date.now() - t0) / 1000).toFixed(1) + 's');
}
console.log('DONE', id, frames.length);
