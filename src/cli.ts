#!/usr/bin/env node

import { Command } from 'commander';
import { loginCommand } from './commands/login.js';
import { listCommand } from './commands/list.js';
import { exportCommand } from './commands/export.js';
import { backupCommand } from './commands/backup.js';
import { sendCommand } from './commands/send.js';
import { monitorCommand } from './commands/monitor.js';
import { qzoneCommand } from './commands/qzone.js';
import { napcatCommand } from './commands/napcat.js';
import { adminCommand } from './commands/admin.js';
import { wsMonitorCommand } from './commands/ws-monitor.js';
import { setupCommand } from './commands/setup.js';
import { profileCommand } from './commands/profile.js';

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
qzoneCommand(program);
napcatCommand(program);
adminCommand(program);
wsMonitorCommand(program);
setupCommand(program);
profileCommand(program);

program.parse();
