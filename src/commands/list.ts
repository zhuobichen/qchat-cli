import { Command } from 'commander';
import chalk from 'chalk';
import { authManager } from '../core/auth.js';

export function listCommand(program: Command): void {
  program
    .command('list')
    .description('列出可导出的聊天会话')
    .option('-t, --type <type>', '会话类型：friend（好友）或 group（群组）')
    .option('-s, --search <keyword>', '搜索会话')
    .option('--limit <number>', '限制返回数量', '50')
    .action(async (options) => {
      // 检查连接
      if (!authManager.isConfigured()) {
        console.log(chalk.red('请先配置 NapCatQQ 连接'));
        console.log(chalk.dim('运行: qce login --host <host> --port <port>'));
        return;
      }

      console.log('正在获取会话列表...');

      try {
        const client = authManager.getClient();
        const limit = parseInt(options.limit);

        // 获取好友列表
        if (!options.type || options.type === 'friend') {
          const friends = await client.getFriendList();
          const filteredFriends = options.search
            ? friends.filter(f =>
                f.nickname.includes(options.search) ||
                f.remark.includes(options.search) ||
                f.user_id.toString().includes(options.search)
              )
            : friends;

          console.log(chalk.bold(`\n好友列表 (${filteredFriends.length}):`));
          console.log(chalk.dim('─'.repeat(50)));

          for (const friend of filteredFriends.slice(0, limit)) {
            const name = friend.remark || friend.nickname;
            console.log(`  ${chalk.cyan(friend.user_id.toString().padEnd(12))} ${name}`);
          }
        }

        // 获取群列表
        if (!options.type || options.type === 'group') {
          const groups = await client.getGroupList();
          const filteredGroups = options.search
            ? groups.filter(g =>
                g.group_name.includes(options.search) ||
                g.group_id.toString().includes(options.search)
              )
            : groups;

          console.log(chalk.bold(`\n群组列表 (${filteredGroups.length}):`));
          console.log(chalk.dim('─'.repeat(50)));

          for (const group of filteredGroups.slice(0, limit)) {
            console.log(
              `  ${chalk.green(group.group_id.toString().padEnd(12))} ${group.group_name} ${chalk.dim(`(${group.member_count}人)`)}`
            );
          }
        }
      } catch (error) {
        console.log(chalk.red('获取会话列表失败:'), error);
      }
    });
}
