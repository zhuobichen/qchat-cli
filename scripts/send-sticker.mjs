/**
 * 往群里或私聊发一张本地表情。
 *
 * 为什么单独写一个：表情库有 963 张，但之前只有 MCP 的 send_sticker 能发，
 * 而它要求两段式确认 + MCP_ALLOW_GROUP_SEND=1，我平时发一句话根本不会走那条路，
 * 结果就是"有表情库但从不发表情"。这个脚本让发表情和发文字一样便宜。
 *
 * 用法：
 *   node scripts/send-sticker.mjs 吃              # 按意图挑一张，发到默认群
 *   node scripts/send-sticker.mjs 无语 913807639
 *   node scripts/send-sticker.mjs --id <stickerId>
 *   node scripts/send-sticker.mjs --list 吃       # 只看候选，不发
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_GROUP = 913807639;
const args = process.argv.slice(2);

const flagIdx = args.indexOf('--id');
const listIdx = args.indexOf('--list');
const explicitId = flagIdx >= 0 ? args[flagIdx + 1] : '';
const listKw = listIdx >= 0 ? args[listIdx + 1] : '';
const positional = args.filter((a) => !a.startsWith('--') && a !== explicitId && a !== listKw);
const intent = positional[0] ?? '笑';
const group = Number(positional[1] ?? DEFAULT_GROUP);

const sticker = await import('../dist/core/sticker.js');

if (listKw) {
  const cands = await sticker.pickSticker(listKw);
  console.log('挑中:', cands?.label ?? '(无)');
  process.exit(0);
}

let picked = null;
if (explicitId) {
  const f = sticker.stickerFile(explicitId);
  if (!f) {
    console.log('找不到这个 id:', explicitId);
    process.exit(1);
  }
  picked = { id: explicitId, label: explicitId, file: f };
} else {
  const p = await sticker.pickSticker(intent);
  if (!p) {
    console.log(`「${intent}」没挑到合适的表情`);
    process.exit(1);
  }
  const f = sticker.stickerFile(p.id);
  if (!f) {
    console.log('表情文件不存在:', p.id);
    process.exit(1);
  }
  picked = { ...p, file: f };
}

const cfgPath = path.join(os.homedir(), '.qchat-cli', 'NapCat.Shell', 'napcat', 'config', 'onebot11_2396130865.json');
const token = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))?.network?.httpServers?.[0]?.token ?? '';

const res = await fetch('http://127.0.0.1:3000/send_group_msg', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify({ group_id: group, message: [{ type: 'image', data: { file: picked.file } }] }),
});
const j = await res.json();
console.log(`已发送「${picked.label}」→ 群 ${group}（${j.status} ${j.retcode ?? ''}）`);
