/**
 * 派活：把一件事丢给另一个会话去做，我自己只负责聊天。
 *
 * 为什么要有：群里有人喊"帮我写个 X"的时候，如果我在这条会话里现写代码，
 * 几十个工具调用的输出会全塞进聊天上下文——聊到后面我就记不清谁说过什么了。
 * 换个会话干，等于给这件事单独开一块脑子：活干完了把结论拿回来，过程不进我的上下文。
 *
 * 通道：DSH 的 supervisor 命令口子（和 qq-watch 投递用的是同一个），
 *   POST http://127.0.0.1:3080/dsh-agent-supervisor/command
 *   支持 op: list / start / send / tail / createSession / createWorkspace / ensureFullAccess
 *
 * 用法：
 *   node scripts/dispatch.mjs new "把 README 的安装步骤补全" --title 补README
 *   node scripts/dispatch.mjs new "写个 csv 去重脚本" --notify group:913807639   # 干完自动回报到群
 *   node scripts/dispatch.mjs list                    # 列会话（标出在跑的）
 *   node scripts/dispatch.mjs tail <会话id>            # 看它最后说了什么
 *   node scripts/dispatch.mjs say  <会话id> "改一下"    # 补一句需求
 *   node scripts/dispatch.mjs kill <会话id>            # 只是提醒：这里没有 kill，用 interrupt
 */
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendFileSync, readFileSync, writeFileSync, existsSync } from 'node:fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENDPOINT = process.env.DSH_SUPERVISOR_URL || 'http://127.0.0.1:3080/dsh-agent-supervisor/command';
const KEY = process.env.DSH_SUPERVISOR_KEY || '';
const LANES_FILE = path.join(ROOT, 'private', 'lanes.json');

const argv = process.argv.slice(2);
const cmd = argv[0];

function flag(name, def = '') {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? (argv[i + 1] ?? def) : def;
}
const positional = argv.slice(1).filter((a, i, arr) => !a.startsWith('--') && !(i > 0 && arr[i - 1] === '--title') && !(i > 0 && arr[i - 1] === '--notify') && !(i > 0 && arr[i - 1] === '--limit') && !(i > 0 && arr[i - 1] === '--lane') && !(i > 0 && arr[i - 1] === '--cwd'));

/** 车道登记表：一个车道 = 一个常驻子会话 + 一个固定目录 + 一段角色设定 */
function readLanes() {
  if (!existsSync(LANES_FILE)) return { lanes: {} };
  return JSON.parse(readFileSync(LANES_FILE, 'utf8'));
}
function writeLanes(data) {
  writeFileSync(LANES_FILE, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

async function call(op, extra = {}) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(KEY ? { 'x-supervisor-key': KEY } : {}) },
    body: JSON.stringify({ op, ...extra }),
    signal: AbortSignal.timeout(30_000),
  });
  return res.json();
}

function die(msg) {
  console.error(`fail  ${msg}`);
  process.exit(1);
}

/** 会话在跑吗 */
async function isRunning(sessionId) {
  const j = await call('list');
  const s = (j.sessions || []).find((x) => x.sessionId === sessionId);
  return s ? Boolean(s.running) : false;
}

/** 取最后一条 agent 发言——那才是"结论"，前面的工具日志不算 */
async function lastAgentText(sessionId, limit = 40) {
  const j = await call('tail', { sessionId, limit });
  const msgs = j.messages || [];
  for (let i = msgs.length - 1; i >= 0; i -= 1) {
    if (msgs[i].role === 'agent' && String(msgs[i].text || '').trim()) return msgs[i].text;
  }
  return '';
}

/** 后台等它干完再回报——不占我的回合 */
function spawnNotifier(sessionId, target, title) {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'watch', sessionId, '--notify', target, '--title', title || ''], {
    detached: true,
    stdio: 'ignore',
    cwd: ROOT,
    windowsHide: true,
  });
  child.unref();
  return child.pid;
}

/**
 * 把一条活送进某个车道。
 * 车道里有活的会话就 `send` 进去（它自己会接着干），没有就先 `start` 建一个。
 * 注意 op:start 一定会新建会话，所以只有空车道才用它。
 */
async function dispatchToLane(laneName, task, { notify = '', titleOverride = '' } = {}) {
  const data = readLanes();
  const lane = data.lanes[laneName];
  if (!lane) die(`没有这个车道: ${laneName}（现有: ${Object.keys(data.lanes).join(' / ')}）`);

  let sid = lane.sessionId || '';
  let created = false;

  // 车道会话没了/被删了，就当没有
  if (sid) {
    const j = await call('list');
    if (!(j.sessions || []).some((s) => s.sessionId === sid)) {
      sid = '';
      lane.sessionId = '';
    }
  }

  if (!sid) {
    // 第一次：用角色设定 + 第一条任务一起开个会话
    const where = lane.subdir ? `${lane.cwd}（产物放 ${lane.subdir}/ 子目录）` : lane.cwd;
    const seed = `${lane.role}\n\n当前工作目录：${where}\n\n第一件活：${task}`;
    // cwd 一定要做成 Windows 原生形式（反斜杠）。
    // 踩过：传 "D:/qq助手"（正斜杠）时会话照跑，但 identity.cwd 存成 "D:/qq助手"，
    // 而 workspace.json 里登记的是 "D:\\qq助手"——字符串不相等，Web UI 侧栏就归不进那个工作区，
    // 看起来像"会话没生成"。path.resolve 在 Windows 上正好给反斜杠。
    const r = await call('start', { text: seed, title: titleOverride || lane.title, cwd: path.resolve(lane.cwd) });
    if (!r.ok) die(`开车道失败: ${JSON.stringify(r).slice(0, 160)}`);
    sid = r.sessionId;
    lane.sessionId = sid;
    lane.createdAt = new Date().toISOString();
    writeLanes(data);
    created = true;
  } else {
    if (await isRunning(sid)) die(`车道上一个活还没干完（${sid}），等它收尾再派`);
    const r = await call('send', { sessionId: sid, text: task });
    if (!r.ok) die(`派活失败: ${JSON.stringify(r).slice(0, 160)}`);
  }

  if (!notify) return { sid, created };
  const pid = spawnNotifier(sid, notify, titleOverride || lane.title);
  return { sid, created, notifyPid: pid };
}

async function main() {
  if (!cmd || cmd === 'help' || cmd === '--help') {
    console.log(`用法:
  node scripts/dispatch.mjs lanes                          # 看有哪些车道、谁在跑
  node scripts/dispatch.mjs new "<任务>" [--lane cli|software|data] [--title 名字] [--notify group:<群号>|user:<QQ>] [--cwd 目录]
  node scripts/dispatch.mjs reset-lane <车道>              # 车道会话聊乱了/满了，重开一个
  node scripts/dispatch.mjs list [--limit N]
  node scripts/dispatch.mjs tail <会话id> [--limit N]
  node scripts/dispatch.mjs say <会话id> "<补充要求>"
  node scripts/dispatch.mjs status <会话id>
  node scripts/dispatch.mjs watch <会话id> [--notify 目标]     # 前台等它干完`);
    return;
  }

  // ── 车道 ────────────────────────────────────────────
  if (cmd === 'lanes') {
    const data = readLanes();
    const live = await call('list');
    const byId = new Map((live.sessions || []).map((s) => [s.sessionId, s]));
    for (const [name, lane] of Object.entries(data.lanes)) {
      const s = lane.sessionId ? byId.get(lane.sessionId) : null;
      const state = !lane.sessionId ? '空（还没开）' : !s ? '会话已消失' : s.running ? '▶ 正在干' : '空闲';
      console.log(`${name.padEnd(9)} ${state.padEnd(12)} ${lane.sessionId || '-'}`);
      console.log(`          ${lane.cwd}`);
    }
    return;
  }

  if (cmd === 'reset-lane') {
    const name = positional[0];
    const data = readLanes();
    if (!data.lanes[name]) die(`没有这个车道: ${name}`);
    data.lanes[name].sessionId = '';
    data.lanes[name].createdAt = '';
    writeLanes(data);
    console.log(`ok  ${name} 车道已清空，下次派活会开新会话`);
    return;
  }

  if (cmd === 'new') {
    const task = positional[0];
    if (!task) die('任务不能为空');
    const lane = flag('lane');
    const title = flag('title') || task.slice(0, 18);
    const notify = flag('notify');

    // 指定车道：进那个车道的常驻会话，上下文能接着用
    if (lane) {
      const r = await dispatchToLane(lane, task, { notify, titleOverride: flag('title') });
      console.log(`ok  已派活 → ${r.sid}${r.created ? '（车道新开会话）' : '（接着原来的会话）'}`);
      console.log(`    车道: ${lane}`);
      if (notify) console.log(`    干完回报 → ${notify}${r.notifyPid ? `（守望进程 ${r.notifyPid}）` : ''}`);
      return;
    }

    // 没指定车道：一次性散活，干完就散（默认工作区 D:\qq助手）
    const cwd = flag('cwd', 'D:/qq助手');

    // 三条实测结论，别再走弯路：
    //   1. `op:start` 自己就建会话；传 sessionId 它不认，会另开一个
    //   2. `createSession` 建出来的是空壳，start 也不往里塞
    //   3. 想让活干在项目目录，直接在 start 里给 `cwd`（createWorkspace 那个 workspaceId 不改变子会话的 cwd）
    const started = await call('start', { text: task, title, ...(cwd ? { cwd: path.resolve(cwd) } : {}) });
    if (!started.ok) die(`派活失败: ${JSON.stringify(started).slice(0, 160)}`);
    const sid = started.sessionId;

    let note = '';
    if (notify) {
      const pid = spawnNotifier(sid, notify, title);
      note = `，干完自动回报到 ${notify}（守望进程 ${pid}）`;
    }
    console.log(`ok  已派活 → ${sid}`);
    console.log(`    标题: ${title}${cwd ? `\n    工作区: ${path.resolve(cwd)}` : ''}`);
    console.log(`    任务: ${task.slice(0, 60)}${note}`);
    return;
  }

  if (cmd === 'list') {
    const limit = Number(flag('limit', '15'));
    const j = await call('list');
    const rows = (j.sessions || []).slice(0, limit);
    for (const s of rows) {
      console.log(`${s.running ? '▶' : ' '} ${s.sessionId}  ${(s.title || '(无标题)').slice(0, 24)}`);
    }
    console.log(`\n共 ${j.count} 个会话，▶ 表示正在跑`);
    return;
  }

  if (cmd === 'tail') {
    const sid = positional[0];
    if (!sid) die('要给会话 id');
    const limit = Number(flag('limit', '10'));
    const j = await call('tail', { sessionId: sid, limit });
    if (!j.ok) die(JSON.stringify(j).slice(0, 200));
    for (const m of j.messages || []) {
      const who = m.role === 'agent' ? '我' : m.role === 'user' ? '人' : m.role;
      console.log(`[${who}] ${String(m.text || '').slice(0, 300)}`);
    }
    return;
  }

  if (cmd === 'say') {
    const sid = positional[0];
    const text = positional[1];
    if (!sid || !text) die('用法: say <会话id> "<内容>"');
    const j = await call('send', { sessionId: sid, text });
    if (!j.ok) die(JSON.stringify(j).slice(0, 200));
    console.log(`ok  已发给 ${sid}`);
    return;
  }

  if (cmd === 'status') {
    const sid = positional[0];
    if (!sid) die('要给会话 id');
    console.log((await isRunning(sid)) ? 'running' : 'idle');
    return;
  }

  if (cmd === 'watch') {
    // 前台等：每 10 秒看一眼，跑完就把结论打出来（可选回报到 QQ）
    const sid = positional[0];
    if (!sid) die('要给会话 id');
    const notify = flag('notify');
    const title = flag('title');
    const startedAt = Date.now();
    for (;;) {
      await new Promise((r) => setTimeout(r, 10_000));
      const running = await isRunning(sid);
      if (running) continue;
      // 刚停下可能还没写完最后一段，再等一轮确认
      await new Promise((r) => setTimeout(r, 5_000));
      if (await isRunning(sid)) continue;

      const text = await lastAgentText(sid);
      const mins = Math.round((Date.now() - startedAt) / 60000);
      console.log(`\n=== 干完了（${mins} 分钟）===\n${text}`);

      if (notify) {
        const body = `【${title || '派下去的活'}】干完了（${mins} 分钟）：\n${text.slice(0, 600)}`;
        // 同步发、把结果记日志。私聊这条链坏过一次（禁言那次"发了但没人收到"），
        // 不记下来就等于没发。
        const r = spawnSync(process.execPath, [path.join(ROOT, 'dist', 'cli.js'), 'say', notify, body], {
          encoding: 'utf8',
          cwd: ROOT,
          timeout: 120_000,
        });
        const line = `[${new Date().toLocaleString('zh-CN')}] notify ${notify} exit=${r.status} out=${(r.stdout || '').trim().slice(0, 120)} err=${(r.stderr || '').trim().slice(0, 120)}`;
        try { appendFileSync(path.join(ROOT, 'output', 'dispatch.log'), line + '\n'); } catch { /* 日志写不上不影响投递 */ }
        console.log(line);
      }
      return;
    }
  }

  die(`不认识的子命令: ${cmd}`);
}

main().catch((e) => die(e.message));
