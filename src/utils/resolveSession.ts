import { authManager } from '../core/auth.js';
import chalk from 'chalk';

/**
 * 将用户输入解析为会话 ID
 * 支持：纯数字 QQ 号 / 好友昵称 / 好友备注 / 群名
 * 匹配不到时回退为数字解析
 */
export async function resolveSession(input: string): Promise<number> {
  // 纯数字 → 直接返回
  if (/^\d{5,}$/.test(input)) {
    return parseInt(input);
  }

  try {
    const client = authManager.getClient();

    // 搜索好友（昵称 + 备注）
    const friends = await client.getFriendList();
    const friendMatch = friends.find(f =>
      f.nickname.includes(input) || f.remark.includes(input)
    );
    if (friendMatch) {
      console.log(chalk.gray(`  → ${friendMatch.remark || friendMatch.nickname} (${friendMatch.user_id})`));
      return friendMatch.user_id;
    }

    // 搜索群组
    const groups = await client.getGroupList();
    const groupMatch = groups.find(g => g.group_name.includes(input));
    if (groupMatch) {
      console.log(chalk.gray(`  → ${groupMatch.group_name} (${groupMatch.group_id})`));
      return groupMatch.group_id;
    }
  } catch {
    // API 不可用，回退
  }

  // 都匹配不到 → 尝试按数字
  const asNum = parseInt(input);
  if (!isNaN(asNum)) return asNum;

  console.log(chalk.red(`找不到 "${input}" 对应的好友或群`));
  console.log(chalk.gray('提示: 运行 qce list friends 查看所有好友'));
  process.exit(1);
}
