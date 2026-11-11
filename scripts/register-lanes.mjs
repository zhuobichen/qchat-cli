// 一次性补登记：把 lanes.json 里的会话塞进 workspace.json 的 sessionIds
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const WF = 'D:\\github_project\\ZhaoWen_GitHub维护\\dsh\\home\\storages\\workspace.json';
const lanes = JSON.parse(fs.readFileSync(path.join(ROOT, 'private', 'lanes.json'), 'utf8')).lanes;

const raw = fs.readFileSync(WF, 'utf8');
const j = JSON.parse(raw);
const norm = (p) => path.resolve(p).toLowerCase();
let changed = false;

for (const [name, lane] of Object.entries(lanes)) {
  if (!lane.sessionId) {
    console.log(name, '没有会话，跳过');
    continue;
  }
  const entry = Object.entries(j.tables.workspaces).find(([, w]) => norm(w.path) === norm(lane.cwd));
  if (!entry) {
    console.log(name, '找不到匹配工作区:', lane.cwd);
    continue;
  }
  const [id, w] = entry;
  w.sessionIds = w.sessionIds || [];
  if (w.sessionIds.includes(lane.sessionId)) {
    console.log(name, '已经在', w.title, '里');
    continue;
  }
  w.sessionIds.unshift(lane.sessionId);
  w.updatedAt = Date.now();
  changed = true;
  console.log(name, '→ 登记进', w.title, `(${id})，现在共 ${w.sessionIds.length} 条`);
}

if (changed) {
  fs.writeFileSync(`${WF}.bak-dispatch`, raw, 'utf8');
  fs.writeFileSync(WF, JSON.stringify(j, null, 2), 'utf8');
  console.log('已写回 workspace.json');
} else {
  console.log('没有需要改的');
}
