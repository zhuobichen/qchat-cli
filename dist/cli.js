#!/usr/bin/env node
import { Command } from 'commander';
import { loginCommand } from './commands/login.js';
import { listCommand } from './commands/list.js';
import { exportCommand } from './commands/export.js';
import { backupCommand } from './commands/backup.js';
import { sendCommand } from './commands/send.js';
import { monitorCommand } from './commands/monitor.js';
const program = new Command();
program
    .name('qce')
    .description('QQ Chat Exporter CLI - 导出 QQ 聊天记录')
    .version('0.1.0');
// 注册子命令
loginCommand(program);
listCommand(program);
exportCommand(program);
backupCommand(program);
sendCommand(program);
monitorCommand(program);
program.parse();
//# sourceMappingURL=cli.js.map