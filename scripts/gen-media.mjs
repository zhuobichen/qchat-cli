/**
 * 生成图片/视频并（可选）直接发到 QQ 群。
 *
 * 为什么不在 qchat-cli 里重写一遍驱动：豆包桌面版的 CDP 自动化（点输入框、
 * 等生成、取产物、处理水印标记）都在 @zhuobichen/dsh-image-gen 里，写好了就别复制。
 * 这里只做两件它没有的事：一是命令行友好，二是生成完直接发群。
 *
 * 用法：
 *   node scripts/gen-media.mjs --image "一只穿西装的柴犬在开会"
 *   node scripts/gen-media.mjs --image "..." --send                 # 生成并发到默认群
 *   node scripts/gen-media.mjs --video "镜头固定，角色眨眼" --ref 参考图.png --send
 *   node scripts/gen-media.mjs --image "..." --out D:/x/y.png       # 指定输出
 *
 * 注意：视频很慢（2-6 分钟），且依赖豆包桌面版带 --remote-debugging-port=9333 启动并已登录。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const PLUGIN = 'D:/github_project/ZhaoWen_GitHub维护/dsh/home/profiles/web/node_modules/@zhuobichen/dsh-image-gen';
const { createDoubaoDriver } = await import('file://' + PLUGIN + '/lib/doubao.js');

const DEFAULT_GROUP = 913807639;

const args = process.argv.slice(2);
const take = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : '';
};
const has = (flag) => args.includes(flag);

const imagePrompt = take('--image');
const videoPrompt = take('--video');
const refs = [];
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--ref' && args[i + 1]) refs.push(args[i + 1]);
}
const outPath = take('--out');
const sendFile = take('--send-file');
const send = has('--send');
const groupIdx = args.indexOf('--group');
const group = Number(groupIdx >= 0 ? args[groupIdx + 1] : DEFAULT_GROUP);

if (sendFile) {
  // 只发文件：不发新的，把已有产物推群
  const cfgPath = path.join(os.homedir(), '.qchat-cli', 'NapCat.Shell', 'napcat', 'config', 'onebot11_2396130865.json');
  const token = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))?.network?.httpServers?.[0]?.token ?? '';
  const isVideo2 = /\.(mp4|mov|webm)$/i.test(sendFile);
  const abs2 = path.resolve(sendFile);   // 同上：必须绝对路径
  const seg2 = isVideo2 ? { type: 'video', data: { file: abs2 } } : { type: 'image', data: { file: abs2 } };
  const r2 = await fetch('http://127.0.0.1:3000/send_group_msg', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ group_id: group, message: [seg2] }),
  });
  const j2 = await r2.json();
  console.log(`已发群 ${group}: ${j2.status} ${j2.retcode ?? ''}（${isVideo2 ? '视频' : '图片'}）`);
  process.exit(0);
}

if (!imagePrompt && !videoPrompt) {
  console.log('用法: node scripts/gen-media.mjs --image "描述" [--send] [--group 群号]');
  console.log('      node scripts/gen-media.mjs --video "描述" [--ref 图] [--send]');
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outputBase = outPath
  ? outPath.replace(/\.(png|jpg|jpeg|mp4)$/i, '')
  : `output/gen-${stamp}`;

const driver = createDoubaoDriver({ newChat: true, videoTimeoutMs: 900_000 });

console.log(videoPrompt ? '生成视频（可能 2-6 分钟）...' : '生成图片...');
const t0 = Date.now();

const out = videoPrompt
  ? await driver.generateVideo(videoPrompt, { outputBase, referenceImages: refs })
  : await driver.generate(imagePrompt, { outputBase, referenceImages: refs });

const secs = Math.round((Date.now() - t0) / 1000);
const file = out?.path ?? out?.file ?? outputBase;
console.log(`完成（${secs} 秒）: ${file}`);
if (!fs.existsSync(file)) {
  console.log('产物路径不存在，原样返回:', JSON.stringify(out).slice(0, 300));
  process.exit(1);
}

if (!send) {
  console.log('（未加 --send，只生成不发送）');
  process.exit(0);
}

// 发群
const cfgPath = path.join(os.homedir(), '.qchat-cli', 'NapCat.Shell', 'napcat', 'config', 'onebot11_2396130865.json');
const token = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))?.network?.httpServers?.[0]?.token ?? '';
const absFile = path.resolve(file);   // NapCat 只认绝对路径，相对路径报"识别URL失败"
const isVideo = /\.(mp4|mov|webm)$/i.test(absFile);
const seg = isVideo
  ? { type: 'video', data: { file: absFile } }
  : { type: 'image', data: { file: absFile } };

const res = await fetch('http://127.0.0.1:3000/send_group_msg', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify({ group_id: group, message: [seg] }),
});
const j = await res.json();
console.log(`已发群 ${group}: ${j.status} ${j.retcode ?? ''}（${isVideo ? '视频' : '图片'}）`);
