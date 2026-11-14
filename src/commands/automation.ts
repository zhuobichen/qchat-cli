/**
 * qce automation —— 一键停/起整套常驻自动化。
 *
 * 为什么需要：号主不登 QQ 的时候，那四个常驻进程（投递 / 看门狗 / 戳一戳 / 日记）
 * 加上 NapCat 一直空转，看门狗还会每 20 分钟尝试重启、弹二维码——没人扫就是白折腾。
 * 以前只能一条条 Stop-Process，下次又得记着起哪几个。
 *
 * 两个东西：
 *   1. 标记文件 private/.automation-paused —— 表示"人主动停的"，体检脚本看到它会说"已暂停"，
 *      不会当成故障去重启（真正的故障才该重启）。
 *   2. 进程控制 —— 用 PowerShell 按命令行匹配，停/起那几类 node 进程；可选连 QQ/NapCat 一起。
 */
import { Command } from 'commander';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MARK = join(ROOT, 'private', '.automation-paused');

/** 要管的那几个常驻进程：命令行里出现这些就认 */
const RESIDENTS = ['qq-watch.mjs', 'qq-watchdog.mjs', 'qq-poke-watch.mjs', 'diary-scheduler.mjs', 'qce-auto.mjs'];

function ps(script: string): string {
  const r = spawnSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8', timeout: 60_000 });
  return `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
}

interface ProcRow {
  pid: number;
  cmd: string;
}

function listNodes(): ProcRow[] {
  const out = ps(
    `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ` +
    `ForEach-Object { "$($_.ProcessId)|$($_.CommandLine)" }`,
  );
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.includes('|'))
    .map((l) => {
      const [pid, ...rest] = l.split('|');
      return { pid: Number(pid), cmd: rest.join('|') };
    })
    .filter((p) => Number.isFinite(p.pid));
}

function residents(): ProcRow[] {
  return listNodes().filter((p) => RESIDENTS.some((r) => p.cmd.includes(r)));
}

function qqProcs(): ProcRow[] {
  const out = ps(
    `Get-Process QQ,NapCatWinBootMain -ErrorAction SilentlyContinue | ForEach-Object { "$($_.Id)|$($_.ProcessName)" }`,
  );
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.includes('|'))
    .map((l) => {
      const [pid, name] = l.split('|');
      return { pid: Number(pid), cmd: name ?? '' };
    })
    .filter((p) => Number.isFinite(p.pid));
}

function kill(pids: number[]): number {
  if (!pids.length) return 0;
  ps(pids.map((p) => `Stop-Process -Id ${p} -Force -ErrorAction SilentlyContinue`).join('; '));
  return pids.length;
}

function marker(): { at: string; reason?: string } | null {
  try {
    if (!existsSync(MARK)) return null;
    return JSON.parse(readFileSync(MARK, 'utf8'));
  } catch {
    return { at: '?' };
  }
}

/** 体检脚本会读它：主动停 ≠ 故障，别去重启 */
export function isPaused(): boolean {
  return existsSync(MARK);
}

export function pauseReason(): string {
  const m = marker();
  return m ? `${m.at}${m.reason ? `（${m.reason}）` : ''}` : '';
}

export function automationCommand(program: Command): void {
  program
    .command('automation <action>')
    .description('一键停/起常驻自动化：stop / start / status（stop 会写暂停标记，体检不再报故障）')
    .option('--with-qq', 'stop 时连 QQ / NapCat 一起停', false)
    .option('--reason <text>', '记一笔为什么停，会写进标记文件')
    .action((action: string, options: { withQQ?: boolean; reason?: string }) => {
      const act = String(action || '').toLowerCase();

      if (act === 'status') {
        const m = marker();
        const res = residents();
        const qq = qqProcs();
        console.log('');
        console.log(`  暂停标记   ${m ? chalk.yellow(`有（${m.at}${m.reason ? '，' + m.reason : ''}）`) : chalk.green('无')}`);
        console.log(`  常驻进程   ${res.length ? chalk.green(res.length + ' 个在跑') : chalk.gray('没有在跑')}`);
        for (const p of res) {
          const which = RESIDENTS.find((r) => p.cmd.includes(r)) ?? '?';
          console.log(`             ${chalk.gray(String(p.pid).padEnd(7))} ${which}`);
        }
        console.log(`  QQ/NapCat  ${qq.length ? chalk.green(qq.length + ' 个进程') : chalk.gray('没在跑')}`);
        console.log('');
        return;
      }

      if (act === 'stop') {
        const pids = residents().map((p) => p.pid);
        const qqPids = options.withQQ ? qqProcs().map((p) => p.pid) : [];
        const n = kill([...pids, ...qqPids]);
        mkdirSync(dirname(MARK), { recursive: true });
        writeFileSync(MARK, JSON.stringify({
          at: new Date().toLocaleString('zh-CN'),
          reason: options.reason ?? '手动停止',
          killed: n,
        }, null, 2) + '\n', 'utf8');
        console.log(`ok  停了 ${n} 个进程${options.withQQ ? '（含 QQ / NapCat）' : ''}，已写暂停标记`);
        console.log('    体检脚本看到标记会说「已暂停」，不会再去重启');
        // 2026-11-14 的翻车：CLI 跑在沙箱里，看不到宿主机进程，于是「停了 0 个进程」
        // 却照样写了标记 —— 健康检查说已暂停，watchdog 还在拉 NapCat，二维码一直弹。
        // 所以 0 个进程时必须明说「这次不算停」。
        if (n === 0) {
          console.log(chalk.yellow('    ⚠ 一个进程都没杀掉：多半是沙箱看不到宿主机进程，并非真的没有进程在跑。'));
          console.log(chalk.yellow('      真正停手请在宿主上下文跑：powershell -File ops/stop-all.ps1'));
        }
        return;
      }

      if (act === 'start') {
        if (existsSync(MARK)) rmSync(MARK, { force: true });

        // 为什么用 PowerShell Start-Process 而不是 cmd start：
        // cmd start 在这个项目里踩过两次坑——沙箱里起的进程会被掐，
        // 而且它把参数交给 cmd 解析，路径里的空格和中文容易散架。
        // Start-Process -WindowStyle Hidden 是真正脱离的。
        const targets = [
          '.launch-watch.cmd',
          '.launch-watchdog.cmd',
          '.launch-poke.cmd',
        ];
        const missing = targets.filter((l) => !existsSync(join(ROOT, l)));
        const psLines: string[] = [];
        for (const l of targets) {
          if (missing.includes(l)) continue;
          psLines.push(`Start-Process -FilePath 'cmd.exe' -ArgumentList '/c','${join(ROOT, l).replace(/'/g, "''")}' -WindowStyle Hidden`);
        }
        // 日记调度没有启动器，直接 node 起
        psLines.push(`Start-Process -FilePath '${process.execPath.replace(/'/g, "''")}' -ArgumentList 'scripts\diary-scheduler.mjs' -WorkingDirectory '${ROOT.replace(/'/g, "''")}' -WindowStyle Hidden`);

        if (psLines.length) {
          const r = spawnSync('powershell', ['-NoProfile', '-Command', psLines.join('; ')], {
            cwd: ROOT, encoding: 'utf8', timeout: 60_000,
          });
          if (r.status !== 0) {
            console.log('起进程失败：' + ((r.stderr || r.stdout || '').trim().slice(0, 200) || `exit ${r.status}`));
          }
        }

        console.log(`ok  已清暂停标记，发了 ${psLines.length} 条启动命令`);
        if (missing.length) console.log(`    缺启动器：${missing.join(', ')}`);
        console.log('    注意：QQ 本体要单独扫码登录（.launch-napcat.cmd）');
        console.log('    10 秒后跑 qce automation status 确认真的起来了');
        return;
      }

      console.log('用法：qce automation stop [--with-qq] [--reason 说明] | start | status');
    });
}
