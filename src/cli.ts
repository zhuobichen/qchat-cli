#!/usr/bin/env node

import { Command } from 'commander';
import { loginCommand } from './commands/login.js';
import { listCommand } from './commands/list.js';
import { exportCommand } from './commands/export.js';
import { digestCommand } from './commands/digest.js';
import { searchCommand } from './commands/search.js';
import { mcpCommand } from './commands/mcp.js';
import { indexCommand } from './commands/index-cmd.js';
import { alertCommand } from './commands/alert.js';
import { filesCommand } from './commands/files.js';
import { asrCommand } from './commands/asr.js';
import { backupCommand } from './commands/backup.js';
import { sendCommand } from './commands/send.js';
import { monitorCommand } from './commands/monitor.js';
import { qzoneCommand } from './commands/qzone.js';
import { napcatCommand } from './commands/napcat.js';
import { adminCommand } from './commands/admin.js';
import { wsMonitorCommand } from './commands/ws-monitor.js';
import { setupCommand } from './commands/setup.js';
import { profileCommand } from './commands/profile.js';
import { groupBotCommand } from './commands/group-bot.js';
import { privateBotCommand } from './commands/private-bot.js';
import { faceCommand } from './commands/face.js';
import { accountCommand } from './commands/account.js';
import { authManager } from './core/auth.js';

const program = new Command();

program
  .name('qce')
  .description('QQ Chat Exporter CLI - 导出 QQ 聊天记录')
  .version('0.14.0')
  .option('--account <name>', '本次命令连接的账号（见 qce account list）');

// 所有子命令执行前解析 --account，让 authManager 面向对应实例
program.hook('preAction', (_thisCmd, actionCmd) => {
  const account = actionCmd.optsWithGlobals().account as string | undefined;
  if (account) authManager.setActiveAccount(account);
});

// 注册子命令
loginCommand(program);
listCommand(program);
exportCommand(program);
digestCommand(program);
searchCommand(program);
mcpCommand(program);
indexCommand(program);
alertCommand(program);
filesCommand(program);
asrCommand(program);
backupCommand(program);
sendCommand(program);
monitorCommand(program);
qzoneCommand(program);
napcatCommand(program);
adminCommand(program);
wsMonitorCommand(program);
setupCommand(program);
profileCommand(program);
groupBotCommand(program);
privateBotCommand(program);
faceCommand(program);
accountCommand(program);

program.parse();
