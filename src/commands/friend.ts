import { Command } from 'commander';
import chalk from 'chalk';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { authManager } from '../core/auth.js';

/**
 * `qce friend` —— 好友管理。
 *
 * 一句话说清能力边界：
 *   ✅ 批准/拒绝别人发来的申请（可以配成自动）
 *   ✅ 看好友列表、改备注、删好友、看单向好友
 *   ❌ **主动发起好友申请** —— OneBot 11 没有这个动作，NapCat 也没实现
 *
 * 「主动加人」为什么没有：那要走 QQ 客户端自己的协议，还带设备/短信风控，
 * Bot 框架刻意不开放（放开就等于允许批量加人骚扰）。
 * 真要做只能操作 QQ 客户端界面，属于另一条路。
 */

const POLICY_PATH = 'private/friend-policy.json';

export interface FriendPolicy {
  /** 自动通过所有申请 */
  autoAcceptAll: boolean;
  /** 只自动通过这些 QQ 号 */
  allowFrom: string[];
  /** 自动通过时给的默认备注前缀 */
  remarkPrefix?: string;
}

export const DEFAULT_POLICY: FriendPolicy = {
  autoAcceptAll: false,
  allowFrom: ['1473517806'],
};

export function loadFriendPolicy(path = POLICY_PATH): FriendPolicy {
  try {
    if (!existsSync(path)) return { ...DEFAULT_POLICY };
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    return {
      autoAcceptAll: Boolean(raw?.autoAcceptAll),
      allowFrom: Array.isArray(raw?.allowFrom) ? raw.allowFrom.map(String) : [],
      ...(raw?.remarkPrefix ? { remarkPrefix: String(raw.remarkPrefix) } : {}),
    };
  } catch {
    return { ...DEFAULT_POLICY };
  }
}

export function saveFriendPolicy(policy: FriendPolicy, path = POLICY_PATH): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(policy, null, 2), 'utf8');
}

/** 这个 QQ 号的申请要不要自动通过 */
export function shouldAutoAccept(uin: string | number, policy = loadFriendPolicy()): boolean {
  if (policy.autoAcceptAll) return true;
  return policy.allowFrom.includes(String(uin));
}

export function friendCommand(program: Command): void {
  const getClient = () => authManager.getClient();
  const friend = program
    .command('friend')
    .description('好友管理：批准申请 / 列表 / 备注 / 删除（注意：不能主动加人）');

  // ── 列表 ──────────────────────────────────────────
  friend
    .command('list')
    .description('好友列表')
    .option('-q, --query <text>', '按昵称或备注过滤')
    .action(async (options: { query?: string }) => {
      const client = getClient();
      const list = await client.getFriendList();
      const q = options.query?.toLowerCase();
      const rows = q
        ? list.filter((f: any) => `${f.remark ?? ''}${f.nickname ?? ''}`.toLowerCase().includes(q))
        : list;
      console.log(chalk.bold(`好友 (${rows.length} 人)`));
      for (const f of rows) {
        const name = f.remark || f.nickname || '(无昵称)';
        const tag = f.remark && f.nickname && f.remark !== f.nickname ? `  ${chalk.gray(`(${f.nickname})`)}` : '';
        console.log(`  ${String(f.user_id).padEnd(12)} ${name}${tag}`);
      }
    });

  // ── 待处理申请 ────────────────────────────────────
  friend
    .command('pending')
    .description('待处理的好友申请（NapCat 的「可疑好友」列表）')
    .action(async () => {
      const client = getClient();
      let rows: any[] = [];
      try {
        rows = await client.getDoubtFriendsAddRequest();
      } catch (error) {
        console.log(chalk.yellow(`取不到待处理列表: ${(error as Error).message}`));
        console.log(chalk.gray('这个号可能没有任何待处理申请。'));
        return;
      }
      if (!rows || rows.length === 0) {
        console.log('没有待处理的好友申请');
        return;
      }
      console.log(chalk.bold(`待处理申请 (${rows.length} 条)`));
      for (const r of rows) {
        const uin = r.uin ?? r.user_id ?? '?';
        const name = r.nick ?? r.nickname ?? '';
        const msg = r.msg ?? r.comment ?? '';
        const flag = r.flag ?? r.uid ?? '';
        console.log(`  ${String(uin).padEnd(12)} ${name}  ${chalk.gray(msg)}`);
        console.log(`    flag: ${flag}`);
      }
    });

  // ── 批准 ──────────────────────────────────────────
  friend
    .command('approve <flag>')
    .description('批准一条好友申请（flag 从 pending 里取）')
    .option('-r, --remark <text>', '给对方的备注')
    .action(async (flag: string, options: { remark?: string }) => {
      const client = getClient();
      await client.setFriendAddRequest(flag, true, options.remark ?? '');
      console.log(chalk.green('已批准'));
    });

  // ── 拒绝 ──────────────────────────────────────────
  friend
    .command('reject <flag>')
    .description('拒绝一条好友申请')
    .action(async (flag: string) => {
      const client = getClient();
      await client.setFriendAddRequest(flag, false, '');
      console.log(chalk.green('已拒绝'));
    });

  // ── 改备注 ────────────────────────────────────────
  friend
    .command('remark <uin> <text>')
    .description('改好友备注')
    .action(async (uin: string, text: string) => {
      const client = getClient();
      await client.setFriendRemark(Number(uin), text);
      console.log(chalk.green(`已把 ${uin} 的备注改为「${text}」`));
    });

  // ── 删好友 ────────────────────────────────────────
  friend
    .command('rm <uin>')
    .description('删除好友')
    .action(async (uin: string) => {
      const client = getClient();
      await client.deleteFriend(Number(uin));
      console.log(chalk.green(`已删除 ${uin}`));
    });

  // ── 单向好友 ──────────────────────────────────────
  friend
    .command('oneway')
    .description('单向好友（我删了对方，但对方还有我）')
    .action(async () => {
      const client = getClient();
      const rows = await client.getUnidirectionalFriendList();
      if (!rows || rows.length === 0) {
        console.log('没有单向好友');
        return;
      }
      console.log(chalk.bold(`单向好友 (${rows.length} 人)`));
      for (const r of rows) console.log(`  ${String(r.uin ?? r.user_id).padEnd(12)} ${r.nick ?? r.nickname ?? ''}`);
    });

  // ── 自动通过策略 ──────────────────────────────────
  friend
    .command('policy')
    .description('查看/设置自动通过策略')
    .option('--all <bool>', '自动通过所有人 (true/false)')
    .option('--allow <uins>', '只自动通过这些 QQ 号（逗号分隔）')
    .option('--remark-prefix <text>', '自动通过时加的备注前缀')
    .action((options: { all?: string; allow?: string; remarkPrefix?: string }) => {
      const policy = loadFriendPolicy();
      if (options.all !== undefined) policy.autoAcceptAll = options.all === 'true';
      if (options.allow !== undefined) policy.allowFrom = options.allow.split(',').map((x) => x.trim()).filter(Boolean);
      if (options.remarkPrefix !== undefined) policy.remarkPrefix = options.remarkPrefix;
      if (options.all !== undefined || options.allow !== undefined || options.remarkPrefix !== undefined) {
        saveFriendPolicy(policy);
        console.log(chalk.green('策略已保存'));
      }
      console.log(chalk.bold('自动通过策略'));
      console.log(`  通过所有人: ${policy.autoAcceptAll ? chalk.green('是') : '否'}`);
      console.log(`  白名单: ${policy.allowFrom.length ? policy.allowFrom.join(', ') : '(空)'}`);
      console.log(chalk.gray(`  配置文件: ${POLICY_PATH}`));
      console.log('');
      console.log(chalk.gray('注意：这是「批准别人发来的申请」，不是「主动加人」。'));
      console.log(chalk.gray('OneBot 11 / NapCat 没有主动发起好友申请的接口。'));
    });
}
