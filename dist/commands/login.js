import chalk from 'chalk';
import { authManager } from '../core/auth.js';
export function loginCommand(program) {
    program
        .command('login')
        .description('配置 NapCatQQ 连接')
        .option('-H, --host <host>', 'NapCatQQ 主机地址', 'localhost')
        .option('-p, --port <port>', 'NapCatQQ 端口', '3000')
        .option('-t, --token <token>', '认证 Token')
        .option('--test', '测试当前连接')
        .option('--show', '显示当前配置')
        .option('--clear', '清除配置')
        .action(async (options) => {
        // 显示配置
        if (options.show) {
            const config = authManager.getConfig();
            console.log(chalk.bold('当前配置:'));
            console.log(`  主机: ${config.host}`);
            console.log(`  端口: ${config.port}`);
            console.log(`  Token: ${config.token ? '****' : '(未设置)'}`);
            return;
        }
        // 清除配置
        if (options.clear) {
            authManager.clearConfig();
            console.log(chalk.green('配置已清除'));
            return;
        }
        // 测试连接
        if (options.test) {
            console.log('正在测试连接...');
            try {
                const connected = await authManager.testConnection();
                if (connected) {
                    const loginInfo = await authManager.getLoginInfo();
                    console.log(chalk.green('连接成功!'));
                    console.log(`  用户: ${loginInfo.nickname} (${loginInfo.user_id})`);
                }
                else {
                    console.log(chalk.red('连接失败'));
                }
            }
            catch (error) {
                console.log(chalk.red('连接失败:'), error);
            }
            return;
        }
        // 更新配置
        authManager.updateConfig({
            host: options.host,
            port: parseInt(options.port),
            token: options.token,
        });
        console.log(chalk.green('配置已更新'));
        // 测试连接
        console.log('正在测试连接...');
        try {
            const connected = await authManager.testConnection();
            if (connected) {
                const loginInfo = await authManager.getLoginInfo();
                console.log(chalk.green('连接成功!'));
                console.log(`  用户: ${loginInfo.nickname} (${loginInfo.user_id})`);
            }
            else {
                console.log(chalk.yellow('连接失败，请检查 NapCatQQ 是否运行'));
            }
        }
        catch (error) {
            console.log(chalk.yellow('连接失败:'), error);
            console.log(chalk.dim('请确保 NapCatQQ 已启动并配置了 HTTP 服务'));
        }
    });
}
//# sourceMappingURL=login.js.map