import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { authManager } from '../core/auth.js';
import { safetyManager } from '../core/safety.js';
import { resolveSession } from '../utils/resolveSession.js';

export function sendCommand(program: Command): void {
  const send = program
    .command('send')
    .description('发送消息（需要安全授权）');

  // 发送消息子命令
  send
    .command('msg <session> <message>')
    .description('发送消息到指定会话')
    .option('--force', '跳过确认')
    .action(async (session, message, options) => {
      // 检查连接
      if (!authManager.isConfigured()) {
        console.log(chalk.red('请先配置 NapCatQQ 连接'));
        return;
      }

      const sessionId = await resolveSession(session);

      // 检查安全权限
      if (!safetyManager.isAllowed(sessionId)) {
        console.log(chalk.red(`会话 ${sessionId} 未授权发送消息`));
        console.log(chalk.dim('使用 qce safety allow <id> 添加授权'));
        return;
      }

      // 确认发送
      if (!options.force && safetyManager.isConfirmationRequired()) {
        const { confirm } = await inquirer.prompt([{
          type: 'confirm',
          name: 'confirm',
          message: `确认发送消息到 ${sessionId}？`,
          default: false,
        }]);

        if (!confirm) {
          console.log(chalk.yellow('已取消'));
          return;
        }
      }

      // 发送消息
      try {
        const client = authManager.getClient();
        await client.sendPrivateMessage(sessionId, message);
        console.log(chalk.green('消息已发送'));
      } catch (error) {
        console.log(chalk.red('发送失败:'), error);
      }
    });

  // 安全管理子命令
  const safety = program
    .command('safety')
    .description('安全管理');

  safety
    .command('status')
    .description('查看安全配置')
    .action(() => {
      const config = safetyManager.getConfig();
      console.log(chalk.bold('安全配置:'));
      console.log(`  发送功能: ${config.allowSending ? chalk.green('已启用') : chalk.red('已禁用')}`);
      console.log(`  发送确认: ${config.requireConfirmation ? '是' : '否'}`);
      console.log(`  白名单: ${config.allowedSessions.length > 0 ? config.allowedSessions.join(', ') : '(空，允许所有)'}`);
    });

  safety
    .command('enable')
    .description('启用发送功能')
    .action(() => {
      safetyManager.enableSending();
      console.log(chalk.green('发送功能已启用'));
    });

  safety
    .command('disable')
    .description('禁用发送功能')
    .action(() => {
      safetyManager.disableSending();
      console.log(chalk.green('发送功能已禁用'));
    });

  safety
    .command('allow <sessionId>')
    .description('添加会话到白名单')
    .action((sessionId) => {
      const id = parseInt(sessionId);
      safetyManager.allow(id);
      console.log(chalk.green(`已授权会话 ${id}`));
    });

  safety
    .command('deny <sessionId>')
    .description('从白名单移除会话')
    .action((sessionId) => {
      const id = parseInt(sessionId);
      safetyManager.deny(id);
      console.log(chalk.green(`已取消会话 ${id} 的授权`));
    });

  safety
    .command('confirm <enable>')
    .description('设置是否需要发送确认')
    .action((enable) => {
      safetyManager.setRequireConfirmation(enable === 'true' || enable === '1');
      console.log(chalk.green('已更新确认设置'));
    });
}
