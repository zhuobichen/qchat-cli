import { Command } from 'commander';
import chalk from 'chalk';
import { authManager } from '../core/auth.js';
import { safetyManager } from '../core/safety.js';
import { OneBotEvent } from '../core/onebot-client.js';
import { logger } from '../utils/index.js';

/**
 * 格式化消息显示
 */
function formatMessage(event: OneBotEvent): string {
  if (event.post_type !== 'message') return '';

  const time = new Date().toLocaleTimeString('zh-CN');
  let sender: string;
  let target: string;

  if (event.message_type === 'private') {
    sender = event.sender.nickname;
    target = `私聊 ${event.user_id}`;
  } else if (event.message_type === 'group') {
    sender = event.sender.card || event.sender.nickname;
    target = `群 ${event.group_id}`;
  } else {
    sender = event.user_id.toString();
    target = `频道 ${event.channel_id}`;
  }

  const rawMessage = event.raw_message || 
    (Array.isArray(event.message) 
      ? event.message.map((m: { type: string; data: { text?: string } }) => m.type === 'text' ? m.data.text ?? '' : `[${m.type}]`).join('')
      : String(event.message));

  return `[${time}] ${target} | ${sender}: ${rawMessage}`;
}

/**
 * WebSocket 监控命令
 */
export function wsMonitorCommand(program: Command): void {
  const monitor = program
    .command('ws-monitor')
    .description('使用 WebSocket 实时监控消息（推荐，响应更快）');

  // 启动 WebSocket 监控
  monitor
    .command('start [sessions...]')
    .description('启动 WebSocket 实时监控')
    .option('-a, --auto-reply', '启用自动回复')
    .option('--no-auto-reply', '禁用自动回复')
    .option('-p, --private', '只监控私聊')
    .option('-g, --group', '只监控群聊')
    .action(async (sessions, options) => {
      if (!authManager.isConfigured()) {
        console.log(chalk.red('请先配置 NapCatQQ 连接: qce login'));
        return;
      }

      const client = authManager.getClient();
      
      console.log(chalk.bold('\n🚀 WebSocket 实时监控'));
      console.log(chalk.dim('按 Ctrl+C 停止\n'));

      try {
        // 连接 WebSocket
        await client.connect();

        // 获取登录信息
        const loginInfo = await client.getLoginInfo();
        console.log(chalk.green(`已登录: ${loginInfo.nickname} (${loginInfo.user_id})`));

        // 监控消息
        const sessionSet = new Set(sessions.map((s: string) => parseInt(s)));

        // 私聊消息
        client.on('message_private', (event: OneBotEvent) => {
          if (options.private === false) return;
          if (sessionSet.size > 0 && !sessionSet.has(event.user_id)) return;
          if (event.user_id === loginInfo.user_id) return;

          console.log(chalk.cyan(formatMessage(event)));

          // 自动回复
          if (options.autoReply && safetyManager.isAllowed(event.user_id)) {
            console.log(chalk.gray('  → 自动回复已触发（需要配置 AI）'));
          }
        });

        // 群聊消息
        client.on('message_group', (event: any) => {
          if (options.group === false) return;
          if (sessionSet.size > 0 && !sessionSet.has(event.group_id)) return;
          if (event.user_id === loginInfo.user_id) return;

          console.log(chalk.cyan(formatMessage(event)));

          // 自动回复（需要 @机器人）
          if (options.autoReply) {
            const hasAtMe = event.message.some((m: any) => 
              m.type === 'at' && m.data.qq === loginInfo.user_id
            );
            if (hasAtMe && safetyManager.isAllowed(event.group_id)) {
              console.log(chalk.gray('  → 被 @，自动回复已触发（需要配置 AI）'));
            }
          }
        });

        // 消息撤回
        client.on('notice_group_recall', (event: any) => {
          console.log(chalk.yellow(`[撤回] 群 ${event.group_id} 用户 ${event.user_id} 撤回了消息 ${event.message_id}`));
        });

        client.on('notice_friend_recall', (event: any) => {
          console.log(chalk.yellow(`[撤回] 好友 ${event.user_id} 撤回了消息 ${event.message_id}`));
        });

        // 好友请求
        client.on('request_friend', (event: any) => {
          console.log(chalk.blue(`[请求] ${event.user_id} 请求添加好友: ${event.comment}`));
          console.log(chalk.dim(`  标志: ${event.flag}`));
        });

        // 群请求
        client.on('request_group', (event: any) => {
          const type = event.sub_type === 'add' ? '加入' : '邀请';
          console.log(chalk.blue(`[请求] ${event.user_id} 请求${type}群 ${event.group_id}: ${event.comment}`));
          console.log(chalk.dim(`  标志: ${event.flag}`));
        });

        // 戳一戳
        client.on('notice_notify_poke', (event: any) => {
          console.log(chalk.magenta(`[戳一戳] ${event.user_id} 戳了 ${event.target_id || '你'}`));
        });

        // 禁言通知
        client.on('notice_group_ban', (event: any) => {
          if (event.duration === 0) {
            console.log(chalk.yellow(`[群管理] ${event.user_id} 被解除禁言`));
          } else {
            console.log(chalk.yellow(`[群管理] ${event.user_id} 被禁言 ${event.duration} 秒`));
          }
        });

        // 管理员变更
        client.on('notice_group_admin', (event: any) => {
          if (event.sub_type === 'set') {
            console.log(chalk.green(`[群管理] ${event.user_id} 成为管理员`));
          } else {
            console.log(chalk.gray(`[群管理] ${event.user_id} 被取消管理员`));
          }
        });

        // 新好友
        client.on('notice_friend_add', (event: any) => {
          console.log(chalk.green(`[好友] ${event.user_id} 已添加你为好友`));
        });

        console.log(chalk.dim('\n正在监听所有消息事件...\n'));

        // 保持运行
        process.on('SIGINT', () => {
          console.log(chalk.yellow('\n正在断开连接...'));
          client.disconnect();
          process.exit(0);
        });

      } catch (error) {
        console.log(chalk.red('启动监控失败:'), error);
        client.disconnect();
      }
    });

  // 查看 WebSocket 连接状态
  monitor
    .command('status')
    .description('查看 WebSocket 连接状态')
    .action(() => {
      if (!authManager.isConfigured()) {
        console.log(chalk.red('请先配置 NapCatQQ 连接: qce login'));
        return;
      }

      const client = authManager.getClient();
      const connected = client.isConnected();

      console.log(chalk.bold('\n📡 WebSocket 状态'));
      console.log(`  连接状态: ${connected ? chalk.green('已连接') : chalk.red('未连接')}`);

      if (connected) {
        console.log(chalk.green('  可以使用 qce ws-monitor start 启动监控'));
      } else {
        console.log(chalk.yellow('  运行 qce ws-monitor start 自动连接'));
      }
    });

  // 测试 WebSocket 连接
  monitor
    .command('test')
    .description('测试 WebSocket 连接')
    .action(async () => {
      if (!authManager.isConfigured()) {
        console.log(chalk.red('请先配置 NapCatQQ 连接: qce login'));
        return;
      }

      console.log(chalk.bold('\n🔌 测试 WebSocket 连接...\n'));

      const client = authManager.getClient();

      try {
        await client.connect();
        console.log(chalk.green('✅ WebSocket 连接成功!'));

        const loginInfo = await client.getLoginInfo();
        console.log(chalk.green(`✅ 登录信息获取成功: ${loginInfo.nickname} (${loginInfo.user_id})`));

        const status = await client.getStatus();
        console.log(chalk.green(`✅ 状态获取成功: good=${status.good}`));

        client.disconnect();
        console.log(chalk.green('\n✅ 所有测试通过!\n'));

      } catch (error) {
        console.log(chalk.red('❌ WebSocket 连接失败:'), error);
        client.disconnect();
      }
    });
}
