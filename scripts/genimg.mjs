// 异步生图：命令行入口。
//
// 为什么要这个脚本：DSH 的 generate_image 工具是**阻塞**的——调用后要等
// 15~35 秒豆包出图。在会话里等这一下，什么都干不了。
//
// 这个脚本把生图搬到后台进程：
//   node scripts/genimg.mjs "<prompt>" [--out <dir>] [--name <stem>]
// 立即返回，任务在后台跑；出图后打印 IMAGE_PATH=<绝对路径>。
//
// 配合 DSH 的 run_in_background 使用：作业完成会通知 agent，
// 那时候再读图、推送，中间这段完全不占会话。

import { existsSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const PLUGIN_LIB = 'D:\\github_project\\ZhaoWen_GitHub维护\\zhaowen-dsh\\packages\\dsh-image-gen\\lib\\doubao.js';
const DEFAULT_OUT = 'D:\\github_project\\ZhaoWen_GitHub维护\\qchat-cli\\output\\gen';

function parseArgs(argv) {
  const args = { prompt: '', out: DEFAULT_OUT, name: '' };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--out' || a === '-o') args.out = argv[++i];
    else if (a === '--name' || a === '-n') args.name = argv[++i];
    else rest.push(a);
  }
  args.prompt = rest.join(' ').trim();
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (!args.prompt) {
  console.error('用法: node scripts/genimg.mjs "<描述>" [--out 目录] [--name 文件名]');
  process.exit(2);
}

if (!existsSync(PLUGIN_LIB)) {
  console.error(`找不到豆包驱动: ${PLUGIN_LIB}`);
  console.error('先构建插件: cd zhaowen-dsh/packages/dsh-image-gen && npm run build');
  process.exit(2);
}

const { createDoubaoDriver } = await import(`file://${PLUGIN_LIB}`);

const outDir = resolve(args.out);
mkdirSync(outDir, { recursive: true });

const stem = args.name || `gen-${Date.now()}`;
const outputBase = join(outDir, stem);

const driver = createDoubaoDriver();

try {
  const t0 = Date.now();
  const r = await driver.generate(args.prompt, {
    outputBase,
    extraMeta: { source: 'genimg-cli' },
  });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  // 这两行是给调用方解析用的，别改格式
  console.log(`IMAGE_PATH=${r.path}`);
  console.log(`IMAGE_META=${r.width}x${r.height} ${r.format} ${(r.bytes / 1024 / 1024).toFixed(2)}MB ${secs}s`);
} catch (error) {
  console.error(`生图失败: ${error?.message ?? error}`);
  process.exit(1);
}
