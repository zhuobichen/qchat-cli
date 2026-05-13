import { Command } from 'commander';
import chalk from 'chalk';
import { authManager } from '../core/auth.js';
import { MessageFetcher } from '../core/fetcher.js';
import { getExporter, getSupportedFormats } from '../core/exporter/index.js';
import { resolveSession } from '../utils/resolveSession.js';

export function exportCommand(program: Command): void {
  program
    .command('export [session]')
    .description('导出聊天记录')
    .option('-f, --format <format>', '导出格式：json、txt', 'json')
    .option('-o, --output <path>', '输出目录', './output')
    .option('--limit <number>', '限制消息数量')
    .option('--after <date>', '只导出该日期之后的消息（格式：YYYY-MM-DD）')
    .option('--before <date>', '只导出该日期之前的消息（格式：YYYY-MM-DD）')
    .option('--all', '导出所有会话')
    .action(async (session, options) => {
      // 检查连接
      if (!authManager.isConfigured()) {
        console.log(chalk.red('请先配置 NapCatQQ 连接'));
        console.log(chalk.dim('运行: qce login --host <host> --port <port>'));
        return;
      }

      if (!session && !options.all) {
        console.log(chalk.red('请指定会话 ID 或使用 --all 导出所有会话'));
        return;
      }

      // 检查导出格式
      const exporter = getExporter(options.format);
      if (!exporter) {
        console.log(chalk.red(`不支持的导出格式: ${options.format}`));
        console.log(chalk.dim(`支持的格式: ${getSupportedFormats().join(', ')}`));
        return;
      }

      const client = authManager.getClient();
      const fetcher = new MessageFetcher(client);

      try {
        // 解析时间范围
        const after = options.after ? new Date(options.after) : undefined;
        const before = options.before ? new Date(options.before) : undefined;
        const limit = options.limit ? parseInt(options.limit) : undefined;

        if (options.all) {
          // 导出所有会话
          const sessions = await fetcher.getAllSessions();
          console.log(chalk.bold(`找到 ${sessions.length} 个会话，开始导出...`));
          console.log(chalk.dim('─'.repeat(50)));

          let successCount = 0;
          let failCount = 0;

          for (const sess of sessions) {
            try {
              process.stdout.write(`导出 ${sess.name}...`);
              const messages = await fetcher.fetchMessages(sess, { limit, after, before });
              const result = await exporter.export(sess, messages, { output: options.output, format: options.format });
              console.log(chalk.green(` ✓ (${result.messageCount} 条消息)`));
              successCount++;
            } catch (error) {
              console.log(chalk.red(` ✗ ${error}`));
              failCount++;
            }
          }

          console.log(chalk.dim('─'.repeat(50)));
          console.log(chalk.bold(`导出完成: ${successCount} 成功, ${failCount} 失败`));
        } else {
          // 导出单个会话
          const sessionId = await resolveSession(session);

          const sess = await fetcher.getSessionById(sessionId);
          if (!sess) {
            console.log(chalk.red(`未找到会话: ${sessionId}`));
            return;
          }

          console.log(`正在导出 ${sess.name}...`);
          const messages = await fetcher.fetchMessages(sess, { limit, after, before });
          const result = await exporter.export(sess, messages, { output: options.output, format: options.format });

          console.log(chalk.green('导出成功!'));
          console.log(`  文件: ${result.filePath}`);
          console.log(`  消息数: ${result.messageCount}`);
        }
      } catch (error) {
        console.log(chalk.red('导出失败:'), error);
      }
    });
}
