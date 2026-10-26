/**
 * 多账号管理命令
 * qce account add|list|use|remove|show
 *
 * 每个账号对应一个 OneBot 实例（不同 NapCat 多开，端口互不相同）。
 * 不带 --account 的命令连接默认账号；--account <name> 单次覆盖。
 */
import { Command } from 'commander';
import chalk from 'chalk';
import { authManager, AuthConfig } from '../core/auth.js';

function formatAccount(name: string, host: string, port: number, tag: string): void {
  const target = `${host}:${port}`;
  const suffix = tag ? chalk.dim(`  ${tag}`) : '';
  console.log(`  ${chalk.bold(name.padEnd(16))} ${target.padEnd(24)}${suffix}`);
}

export function accountCommand(program: Command): void {
  const account = program
    .command('account')
    .description('多账号管理（一个账号 = 一个 OneBot 实例）');

  // ─── list ───────────────────────────────────────────────
  account
    .command('list')
    .description('列出所有账号')
    .action(() => {
      const list = authManager.listAccounts();
      if (list.length === 0) {
        console.log(chalk.yellow('尚无账号，先 qce account add <名称> --port <端口>'));
        return;
      }
      console.log('');
      console.log(chalk.bold('账号列表'));
      console.log('─'.repeat(46));
      for (const acc of list) {
        const tags: string[] = [];
        if (acc.isDefault) tags.push('默认');
        if (acc.implicit) tags.push('来自旧配置');
        formatAccount(acc.name, acc.config.host, acc.config.port, tags.join(' · '));
      }
      console.log('─'.repeat(46));
      console.log(chalk.dim('用 --account <名称> 临时切换，或 qce account use <名称> 改默认'));
      console.log('');
    });

  // ─── add ────────────────────────────────────────────────
  account
    .command('add <name>')
    .description('新增账号（如：qce account add acc2 --port 3002）')
    .option('-H, --host <host>', 'OneBot 主机地址', '127.0.0.1')
    .option('-p, --port <port>', 'OneBot 端口（必填，多开实例端口不能相同）')
    .option('-t, --token <token>', 'OneBot 认证 Token')
    .option('--use', '添加后设为默认账号')
    .option('--test', '添加后测试连接')
    .action(async (name: string, options: { host: string; port?: string; token?: string; use?: boolean; test?: boolean }) => {
      if (!options.port) {
        console.log(chalk.red('缺少 --port，例如：qce account add acc2 --port 3002'));
        return;
      }
      const port = parseInt(options.port, 10);
      try {
        authManager.addAccount(name, { host: options.host, port, token: options.token });
      } catch (err) {
        console.log(chalk.red((err as Error).message));
        return;
      }
      console.log(chalk.green(`✓ 账号 "${name}" 已添加 (${options.host}:${port})`));

      if (options.use) {
        authManager.useAccount(name);
        console.log(chalk.green(`✓ 已设为默认账号`));
      }

      if (options.test) {
        authManager.setActiveAccount(name);
        try {
          const ok = await authManager.testConnection();
          if (ok) {
            const info = await authManager.getLoginInfo();
            console.log(chalk.green(`✓ 连接成功 — ${info.nickname} (${info.user_id})`));
          } else {
            console.log(chalk.yellow('⚠ 连接失败：OneBot 未响应（实例未启动？）'));
          }
        } catch (err) {
          console.log(chalk.yellow(`⚠ 连接失败：${(err as Error).message}`));
        }
      }
    });

  // ─── use ────────────────────────────────────────────────
  account
    .command('use <name>')
    .description('设置默认账号')
    .action((name: string) => {
      try {
        authManager.useAccount(name);
        console.log(chalk.green(`✓ 默认账号已切换为 "${name}"`));
      } catch (err) {
        console.log(chalk.red((err as Error).message));
      }
    });

  // ─── remove ─────────────────────────────────────────────
  account
    .command('remove <name>')
    .description('删除账号（不影响 NapCat 实例本身）')
    .action((name: string) => {
      try {
        authManager.removeAccount(name);
        console.log(chalk.green(`✓ 账号 "${name}" 已删除`));
      } catch (err) {
        console.log(chalk.red((err as Error).message));
      }
    });

  // ─── show ───────────────────────────────────────────────
  account
    .command('show [name]')
    .description('查看账号详情（缺省为当前生效账号）')
    .action(async (name?: string) => {
      let target: { name: string | null; config: AuthConfig };
      try {
        if (name) {
          const acc = authManager.listAccounts().find((a) => a.name === name);
          if (!acc) throw new Error(`账号 "${name}" 不存在`);
          target = { name: acc.name, config: acc.config };
        } else {
          const active = authManager.getActiveAccountName();
          const config = authManager.getConfig();
          target = { name: active, config };
        }
      } catch (err) {
        console.log(chalk.red((err as Error).message));
        return;
      }

      console.log('');
      console.log(chalk.bold(`账号: ${target.name ?? '(旧配置)'}`));
      console.log(`  主机: ${target.config.host}`);
      console.log(`  端口: ${target.config.port}`);
      console.log(`  Token: ${target.config.token ? '****' : '(未设置)'}`);
      console.log('');

      console.log('测试连接...');
      try {
        if (name) authManager.setActiveAccount(name);
        const ok = await authManager.testConnection();
        if (ok) {
          const info = await authManager.getLoginInfo();
          console.log(chalk.green(`✓ 连接成功 — ${info.nickname} (${info.user_id})`));
        } else {
          console.log(chalk.yellow('⚠ OneBot 未响应'));
        }
      } catch (err) {
        console.log(chalk.yellow(`⚠ 连接失败：${(err as Error).message}`));
      }
      console.log('');
    });
}
