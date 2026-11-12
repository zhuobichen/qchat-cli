/**
 * qce status —— 一屏看清机器人现在什么状态。
 *
 * 为什么要有：以前判断"它还好吗"要翻三处——output/qq-watch*.log 的 mtime、
 * qq-drops.csv 的今日掉线数、再手写一个 curl 打 get_friend_list。
 * 每次问"是不是掉线了"，我都要现拼命令。躺在一屏里，看一眼就知道。
 *
 * 判定口径沿用 qq-health：**看 friend_list 通不通，不看 online 字段**（它滞后）。
 */
import { Command } from 'commander';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import { authManager } from '../core/auth.js';

const GROUP = 913807639;
const SELF = 2396130865;

type Row = { label: string; value: string; ok?: boolean; warn?: boolean };

function fmtAge(sec: number | null): string {
  if (sec === null) return '无记录';
  if (sec < 60) return `${Math.round(sec)} 秒前`;
  if (sec < 3600) return `${Math.round(sec / 60)} 分钟前`;
  if (sec < 86400) return `${(sec / 3600).toFixed(1)} 小时前`;
  return `${(sec / 86400).toFixed(1)} 天前`;
}

function fileAge(path: string): number | null {
  try {
    if (!existsSync(path)) return null;
    return (Date.now() - statSync(path).mtimeMs) / 1000;
  } catch {
    return null;
  }
}

/** 今天（本地时区）掉了几次 */
function dropsToday(path: string): number {
  try {
    const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
    const today = new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD，本地时区
    let n = 0;
    for (const line of lines) {
      if (!line.includes('"down"')) continue;
      const at = line.split(',')[0].replace(/"/g, '');
      const local = new Date(at).toLocaleDateString('sv-SE');
      if (local === today) n += 1;
    }
    return n;
  } catch {
    return 0;
  }
}

export function statusCommand(program: Command): void {
  program
    .command('status')
    .description('一屏看状态：连接 / 进程 / 掉线 / 禁言 / 最后一条消息')
    .option('--group <id>', '看哪个群的禁言与最新消息', String(GROUP))
    .action(async (options: { group?: string }) => {
      const gid = Number(options.group ?? GROUP);
      const rows: Row[] = [];
      const client = (() => {
        try {
          return authManager.getClient();
        } catch {
          return null;
        }
      })();

      const api = async (action: string, params: Record<string, any> = {}, timeoutMs = 6000) => {
        if (!client) throw new Error('未配置账号，先跑 qce login');
        return client.call(action, params);
      };

      // 1) 连接与账号
      let reachable = true;
      try {
        const login: any = await api('get_login_info');
        rows.push({ label: '账号', value: `${login?.nickname ?? '?'} (${login?.user_id ?? '?'})`, ok: true });
      } catch (e: any) {
        reachable = false;
        rows.push({ label: '账号', value: `不可达：${String(e?.message ?? e).slice(0, 40)}`, ok: false });
      }

      // 2) 会话探针（真判据）
      if (reachable) {
        try {
          const friends: any = await api('get_friend_list', {}, 8000);
          const n = Array.isArray(friends) ? friends.length : 0;
          rows.push({
            label: '会话探针',
            value: n > 0 ? `好友 ${n} 个（正常）` : '好友 0 个 ← 半死，该重启了',
            ok: n > 0,
            warn: n === 0,
          });
        } catch (e: any) {
          rows.push({ label: '会话探针', value: `friend_list 失败：${String(e?.message ?? e).slice(0, 30)}`, ok: false });
        }

        // 3) 最新群消息
        try {
          const hist: any = await api('get_group_msg_history', { group_id: gid, count: 10, reverseOrder: true });
          const list: any[] = hist?.messages ?? [];
          const newest = list.slice().sort((a, b) => (b.time ?? 0) - (a.time ?? 0))[0];
          const age = newest ? (Date.now() / 1000 - newest.time) : null;
          rows.push({ label: `群 ${gid}`, value: newest ? `最后一条 ${fmtAge(age)}` : '没有消息' });
        } catch (e: any) {
          rows.push({ label: `群 ${gid}`, value: `读历史失败：${String(e?.message ?? e).slice(0, 30)}`, ok: false });
        }

        // 4) 我自己的禁言状态
        try {
          const me: any = await api('get_group_member_info', { group_id: gid, user_id: SELF, no_cache: true });
          const shut = Number(me?.shut_up_timestamp ?? 0);
          const left = Math.round((shut * 1000 - Date.now()) / 60000);
          rows.push(
            shut * 1000 > Date.now()
              ? { label: '禁言', value: `是，还剩 ${left} 分钟（到 ${new Date(shut * 1000).toLocaleString('zh-CN')}）`, warn: true }
              : { label: '禁言', value: '无', ok: true },
          );
        } catch {
          rows.push({ label: '禁言', value: '查不到（可能不在这个群）' });
        }
      }

      // 5) 常驻进程：用日志新鲜度反推（进程枚举在沙箱里看不到 host_exec 起的进程）
      const watchAge = [fileAge(join(process.cwd(), 'output', 'qq-watch.log')), fileAge(join(process.cwd(), 'output', 'qq-watch-v2.log'))]
        .filter((n): n is number => n !== null);
      const wdAge = fileAge(join(process.cwd(), 'output', 'qq-watchdog.log'));
      const pokeAge = fileAge(join(process.cwd(), 'output', 'poke-watch.log'));

      const alive = (age: number | null, windowSec: number) => (age !== null && age < windowSec);

      rows.push({
        label: 'qq-watch',
        value: watchAge.length ? fmtAge(Math.min(...watchAge)) : '没有日志',
        ok: watchAge.length > 0 && alive(Math.min(...watchAge), 120),
        warn: !(watchAge.length > 0 && alive(Math.min(...watchAge), 120)),
      });
      rows.push({
        label: 'watchdog',
        value: wdAge !== null ? fmtAge(wdAge) : '没有日志',
        ok: wdAge !== null && alive(wdAge, 300),
        warn: !(wdAge !== null && alive(wdAge, 300)),
      });
      rows.push({
        label: 'poke-watch',
        value: pokeAge !== null ? fmtAge(pokeAge) : '没有日志',
        ok: pokeAge !== null && alive(pokeAge, 3600),
        warn: !(pokeAge !== null && alive(pokeAge, 3600)),
      });

      // 6) 掉线台账
      const drops = dropsToday(join(process.cwd(), 'output', 'qq-drops.csv'));
      rows.push({ label: '今日掉线', value: `${drops} 次`, warn: drops >= 3 });

      // 7) 待回复队列
      try {
        const q = JSON.parse(readFileSync(join(process.cwd(), 'private', '.queue', 'pending.json'), 'utf8'));
        rows.push({ label: '待回复', value: `${Array.isArray(q) ? q.length : 0} 条` });
      } catch {
        rows.push({ label: '待回复', value: '0 条' });
      }

      // ── 输出 ──
      console.log('');
      for (const r of rows) {
        const mark = r.ok ? chalk.green('✓') : r.warn ? chalk.yellow('!') : ' ';
        const label = r.label.padEnd(10, ' ');
        const value = r.ok ? chalk.white(r.value) : r.warn ? chalk.yellow(r.value) : chalk.gray(r.value);
        console.log(`  ${mark} ${label} ${value}`);
      }
      console.log('');

      const bad = rows.filter((r) => r.ok === false).length;
      if (bad === 0) console.log(chalk.green('  都正常。'));
      else console.log(chalk.yellow(`  ${bad} 项有问题，看上面对应的那一行。`));
      console.log('');
    });
}
