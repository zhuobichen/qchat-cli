#!/usr/bin/env node
/**
 * 长任务的「落盘 + 自投递」执行器。
 *
 * 解决的问题：
 *   DSH 的后台作业绑在会话上，会话重启/关闭就一起死，交付也没了。
 *   这里把任务写成磁盘记录，并让**任务进程自己负责投递**——
 *   就算我（agent）不在旁边，结果也会发到群里。
 *
 * 用法：
 *   node scripts/task.mjs run --type song --notify group:913807639 --deliver voice \
 *        -- node dist/cli.js song "起风了" -r ref.wav
 *
 *   node scripts/task.mjs list          # 列所有任务（含未完成的）
 *   node scripts/task.mjs show <id>
 *   node scripts/task.mjs pending       # 只看没跑完的（重启后用它检查）
 *
 * 约定：被执行的命令在 stdout 里输出 `RESULT=<文件路径>` 或 `RESULT_TEXT=<文本>`，
 * 执行器据此投递。没有这两行就只记录不投递。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const TASKS_DIR = join(process.cwd(), 'private', 'tasks');
const ONE_BOT = process.env.QCE_ONEBOT ?? 'http://127.0.0.1:3000';

function ensureDir() {
  mkdirSync(TASKS_DIR, { recursive: true });
}

function taskPath(id) {
  return join(TASKS_DIR, `${id}.json`);
}

function readTask(id) {
  const p = taskPath(id);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function writeTask(task) {
  ensureDir();
  writeFileSync(taskPath(task.id), JSON.stringify(task, null, 2), 'utf8');
}

function listTasks() {
  ensureDir();
  return readdirSync(TASKS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        return JSON.parse(readFileSync(join(TASKS_DIR, f), 'utf8'));
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

function readToken() {
  const p = join(homedir(), '.qchat-cli', 'NapCat.Shell', 'napcat', 'config', 'onebot11_2396130865.json');
  try {
    return JSON.parse(readFileSync(p, 'utf8'))?.network?.httpServers?.[0]?.token ?? '';
  } catch {
    return '';
  }
}

/** 把结果投递到 QQ。target 形如 group:123 / private:456 */
async function deliver(target, deliverKind, { file, text }) {
  if (!target) return { sent: false, reason: '没有 notify 目标' };
  const [kind, id] = String(target).split(':');
  if (!kind || !id) return { sent: false, reason: `目标格式不对: ${target}` };
  const action = kind === 'group' ? 'send_group_msg' : 'send_private_msg';
  const idKey = kind === 'group' ? 'group_id' : 'user_id';

  let segment;
  if (deliverKind === 'text' || (!file && text)) {
    segment = { type: 'text', data: { text: String(text ?? '').slice(0, 1500) } };
  } else if (!file || !existsSync(file)) {
    return { sent: false, reason: `结果文件不存在: ${file}` };
  } else if (deliverKind === 'image') {
    const b64 = readFileSync(file).toString('base64');
    segment = { type: 'image', data: { file: `base64://${b64}` } };
  } else {
    const b64 = readFileSync(file).toString('base64');
    segment = { type: deliverKind === 'voice' ? 'record' : 'file', data: { file: `base64://${b64}` } };
  }

  const token = readToken();
  const res = await fetch(`${ONE_BOT}/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ [idKey]: Number(id), message: [segment] }),
    signal: AbortSignal.timeout(120_000),
  });
  const json = await res.json().catch(() => ({}));
  return { sent: json?.status === 'ok', reason: json?.status === 'ok' ? '' : JSON.stringify(json).slice(0, 120) };
}

function parseArgs(argv) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--') {
      out.cmd = argv.slice(i + 1);
      break;
    }
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        out.flags[key] = next;
        i += 1;
      } else {
        out.flags[key] = true;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const sub = args._[0] ?? 'list';

if (sub === 'list' || sub === 'pending') {
  const tasks = listTasks();
  const rows = sub === 'pending'
    ? tasks.filter((t) => t.status === 'queued' || t.status === 'running')
    : tasks;
  if (rows.length === 0) {
    console.log(sub === 'pending' ? '没有未完成的任务 ✅' : '还没有任务');
  } else {
    for (const t of rows) {
      const age = Math.round((Date.now() - (t.createdAt ?? Date.now())) / 1000);
      console.log(`${t.id}  [${t.status}]  ${t.type}  ${age}s前  ${t.target ?? ''}`);
      if (t.error) console.log(`    错误: ${String(t.error).slice(0, 100)}`);
      if (t.result) console.log(`    结果: ${t.result}`);
    }
    if (sub === 'pending') {
      const stale = rows.filter((t) => t.status === 'running' && Date.now() - (t.startedAt ?? 0) > 30 * 60_000);
      if (stale.length) console.log(`\n⚠ 有 ${stale.length} 个任务 running 超过 30 分钟，可能已被中断`);
    }
  }
  process.exit(0);
}

if (sub === 'show') {
  const t = readTask(args._[1]);
  console.log(JSON.stringify(t, null, 2));
  process.exit(t ? 0 : 1);
}

if (sub === 'run') {
  const cmd = args.cmd;
  if (!cmd || cmd.length === 0) {
    console.error('缺少命令。用法: task.mjs run --type X -- ...cmd');
    process.exit(2);
  }
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const task = {
    id,
    type: String(args.flags.type ?? 'generic'),
    target: args.flags.notify ? String(args.flags.notify) : '',
    deliver: String(args.flags.deliver ?? 'file'),
    command: cmd.join(' '),
    status: 'running',
    createdAt: Date.now(),
    startedAt: Date.now(),
  };
  writeTask(task);
  console.log(`[task ${id}] 已登记，开始执行`);

  const child = spawn(cmd[0], cmd.slice(1), {
    // detached：父进程（DSH）挂了它也继续，这正是"落盘自投递"的意义
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    env: process.env,
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => {
    const s = d.toString();
    stdout += s;
    process.stdout.write(s);
  });
  child.stderr.on('data', (d) => {
    const s = d.toString();
    stderr += s;
    process.stderr.write(s);
  });

  child.on('close', async (code) => {
    const fileMatch = stdout.match(/^RESULT=(.+)$/m);
    const textMatch = stdout.match(/^RESULT_TEXT=(.+)$/m);
    task.finishedAt = Date.now();
    task.exitCode = code;
    if (code === 0) {
      task.status = 'done';
      task.result = fileMatch?.[1]?.trim() ?? textMatch?.[1]?.trim() ?? '';
      if (task.result) {
        try {
          const d = await deliver(task.target, task.deliver, {
            file: fileMatch?.[1]?.trim(),
            text: textMatch?.[1]?.trim(),
          });
          task.delivered = d.sent;
          if (!d.sent) task.deliverError = d.reason;
        } catch (error) {
          task.delivered = false;
          task.deliverError = String(error?.message ?? error).slice(0, 160);
        }
      }
    } else {
      task.status = 'failed';
      task.error = (stderr || stdout).slice(-600);
    }
    writeTask(task);
    console.log(`[task ${id}] ${task.status}${task.delivered ? ' 已投递' : ''}`);
    process.exit(code ?? 1);
  });
} else {
  console.error(`未知子命令: ${sub}`);
  process.exit(2);
}
