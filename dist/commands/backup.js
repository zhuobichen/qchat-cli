import chalk from 'chalk';
import { configManager } from '../config/index.js';
import { authManager } from '../core/auth.js';
import { MessageFetcher } from '../core/fetcher.js';
import { getExporter } from '../core/exporter/index.js';
export function backupCommand(program) {
    program
        .command('backup')
        .description('定时备份')
        .option('-s, --schedule <cron>', '设置定时备份（cron 表达式，如 "0 2 * * *" 表示每天凌晨 2 点）')
        .option('-o, --output <path>', '设置备份输出目录')
        .option('-f, --format <format>', '设置备份格式', 'json')
        .option('--add <sessionId>', '添加要备份的会话 ID')
        .option('--remove <sessionId>', '移除要备份的会话 ID')
        .option('--list', '显示备份配置')
        .option('--run', '立即执行备份')
        .action(async (options) => {
        // 显示配置
        if (options.list) {
            const backupConfig = configManager.getBackup();
            console.log(chalk.bold('备份配置:'));
            console.log(`  启用: ${backupConfig.enabled ? '是' : '否'}`);
            console.log(`  定时: ${backupConfig.schedule || '(未设置)'}`);
            console.log(`  输出: ${backupConfig.output}`);
            console.log(`  格式: ${backupConfig.format}`);
            console.log(`  会话: ${backupConfig.sessions.length > 0 ? backupConfig.sessions.join(', ') : '(全部)'}`);
            return;
        }
        // 更新配置
        let configUpdated = false;
        if (options.schedule) {
            configManager.updateBackup({ schedule: options.schedule, enabled: true });
            console.log(chalk.green(`定时备份已设置: ${options.schedule}`));
            configUpdated = true;
        }
        if (options.output) {
            configManager.updateBackup({ output: options.output });
            console.log(chalk.green(`备份输出目录已设置: ${options.output}`));
            configUpdated = true;
        }
        if (options.format) {
            configManager.updateBackup({ format: options.format });
            console.log(chalk.green(`备份格式已设置: ${options.format}`));
            configUpdated = true;
        }
        if (options.add) {
            const backupConfig = configManager.getBackup();
            const sessionId = parseInt(options.add);
            if (!backupConfig.sessions.includes(sessionId)) {
                backupConfig.sessions.push(sessionId);
                configManager.updateBackup({ sessions: backupConfig.sessions });
                console.log(chalk.green(`已添加会话 ${sessionId} 到备份列表`));
            }
            else {
                console.log(chalk.yellow(`会话 ${sessionId} 已在备份列表中`));
            }
            configUpdated = true;
        }
        if (options.remove) {
            const backupConfig = configManager.getBackup();
            const sessionId = parseInt(options.remove);
            const index = backupConfig.sessions.indexOf(sessionId);
            if (index !== -1) {
                backupConfig.sessions.splice(index, 1);
                configManager.updateBackup({ sessions: backupConfig.sessions });
                console.log(chalk.green(`已从备份列表移除会话 ${sessionId}`));
            }
            else {
                console.log(chalk.yellow(`会话 ${sessionId} 不在备份列表中`));
            }
            configUpdated = true;
        }
        if (configUpdated)
            return;
        // 执行备份
        if (options.run) {
            await executeBackup();
            return;
        }
        // 默认显示帮助
        program.commands.find(c => c.name() === 'backup')?.help();
    });
}
async function executeBackup() {
    // 检查连接
    if (!authManager.isConfigured()) {
        console.log(chalk.red('请先配置 NapCatQQ 连接'));
        console.log(chalk.dim('运行: qce login --host <host> --port <port>'));
        return;
    }
    const backupConfig = configManager.getBackup();
    const exporter = getExporter(backupConfig.format);
    if (!exporter) {
        console.log(chalk.red(`不支持的备份格式: ${backupConfig.format}`));
        return;
    }
    console.log(chalk.bold('开始备份...'));
    console.log(chalk.dim('─'.repeat(50)));
    const client = authManager.getClient();
    const fetcher = new MessageFetcher(client);
    try {
        // 获取要备份的会话
        let sessions = await fetcher.getAllSessions();
        if (backupConfig.sessions.length > 0) {
            sessions = sessions.filter(s => backupConfig.sessions.includes(s.id));
        }
        console.log(`找到 ${sessions.length} 个会话需要备份`);
        let successCount = 0;
        let failCount = 0;
        for (const session of sessions) {
            try {
                process.stdout.write(`备份 ${session.name}...`);
                const messages = await fetcher.fetchMessages(session);
                await exporter.export(session, messages, {
                    output: backupConfig.output,
                    format: backupConfig.format,
                });
                console.log(chalk.green(` ✓ (${messages.length} 条消息)`));
                successCount++;
            }
            catch (error) {
                console.log(chalk.red(` ✗ ${error}`));
                failCount++;
            }
        }
        console.log(chalk.dim('─'.repeat(50)));
        console.log(chalk.bold(`备份完成: ${successCount} 成功, ${failCount} 失败`));
        console.log(`备份目录: ${backupConfig.output}`);
    }
    catch (error) {
        console.log(chalk.red('备份失败:'), error);
    }
}
//# sourceMappingURL=backup.js.map