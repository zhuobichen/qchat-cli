import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { authManager } from '../core/auth.js';
import { safetyManager } from '../core/safety.js';
import { MessageMonitor } from '../core/monitor.js';
import { Message } from '../core/onebot-client.js';
import { configManager } from '../config/index.js';
import { resolveSession } from '../utils/resolveSession.js';

// AI 回复生成器（使用简单的模板，可以扩展为调用 AI API）
async function generateReply(message: Message): Promise<string> {
  const content = message.message
    .map(seg => seg.type === 'text' ? seg.data.text : '')
    .join('');

  // 简单的回复逻辑，可以替换为 AI API 调用
  if (content.includes('你好') || content.includes('hi') || content.includes('hello')) {
    return '你好！有什么可以帮你的吗？';
  }

  if (content.includes('?') || content.includes('？')) {
    return '这是一个好问题，让我想想...';
  }

  // 默认不回复
  return '';
}

export function monitorCommand(program: Command): void {
  const monitor = program
    .command('monitor')
    .description('消息监控');

  monitor
    .command('start <sessionId>')
    .description('开始监控指定会话')
    .option('-i, --interval <ms>', '轮询间隔（毫秒）', '5000')
    .option('--auto-reply', '启用自动回复')
    .action(async (sessionId, options) => {
      // 检查连接
      if (!authManager.isConfigured()) {
        console.log(chalk.red('请先配置 NapCatQQ 连接'));
        return;
      }

      const id = await resolveSession(sessionId);

      // 检查安全权限
      if (!safetyManager.isAllowed(id)) {
        console.log(chalk.yellow(`会话 ${id} 未授权，正在添加授权...`));
        safetyManager.allow(id);
        safetyManager.enableSending();
      }

      // 确认启动
      const { confirm } = await inquirer.prompt([{
        type: 'confirm',
        name: 'confirm',
        message: `开始监控会话 ${id}？${options.autoReply ? '（启用自动回复）' : ''}`,
        default: true,
      }]);

      if (!confirm) {
        console.log(chalk.yellow('已取消'));
        return;
      }

      // 创建监控器
      const client = authManager.getClient();
      const messageMonitor = new MessageMonitor(client);
      messageMonitor.addSession(id);

      // 设置自动回复
      if (options.autoReply) {
        messageMonitor.setReplyGenerator(generateReply);
        console.log(chalk.green('自动回复已启用'));
      }

      // 开始监控
      await messageMonitor.startPolling(parseInt(options.interval));

      // 处理退出
      process.on('SIGINT', () => {
        messageMonitor.stop();
        process.exit(0);
      });
    });

  monitor
    .command('stop')
    .description('停止所有监控')
    .action(() => {
      console.log(chalk.green('监控已停止'));
    });
}
