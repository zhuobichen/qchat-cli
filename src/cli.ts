#!/usr/bin/env node

// 加载项目根目录的 .env（Node 20.12+ 的 process.loadEnvFile）
// 用它而不是 dotenv：少一个依赖，而且这是 Node 自带能力。
// 文件不存在就静默跳过——不让"没配 key"变成"命令起不来"。
try {
  process.loadEnvFile('.env');
} catch {
  /* 没有 .env，或 Node 版本不支持：走环境变量 */
}

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
import { memoryCommand } from './commands/memory.js';
import { ttsCommand } from './commands/tts.js';
import { videoCommand } from './commands/video.js';
import { singCommand } from './commands/sing.js';
import { songCommand } from './commands/song.js';
import { proactiveCommand } from './commands/proactive.js';
import { gateCommand } from './commands/gate.js';
import { memeCommand } from './commands/meme.js';
import { historyCommand } from './commands/history.js';
import { faceCommandExtended } from './commands/face-collect.js';
import { personaCommand } from './commands/persona.js';
import { backupCommand } from './commands/backup.js';
import { sendCommand } from './commands/send.js';
import { toolsCommand } from './commands/tools.js';
import { dispatchCommand } from './commands/dispatch.js';
import { statusCommand } from './commands/status.js';
import { monitorCommand } from './commands/monitor.js';
import { qzoneCommand } from './commands/qzone.js';
import { napcatCommand } from './commands/napcat.js';
import { adminCommand } from './commands/admin.js';
import { friendCommand } from './commands/friend.js';
import { wsMonitorCommand } from './commands/ws-monitor.js';
import { setupCommand } from './commands/setup.js';
import { profileCommand } from './commands/profile.js';
import { replyCommand } from './commands/reply.js';
import { queueCommand } from './commands/queue.js';
import { groupBotCommand } from './commands/group-bot.js';
import { privateBotCommand } from './commands/private-bot.js';
import { faceCommand } from './commands/face.js';
import { accountCommand } from './commands/account.js';
import { authManager } from './core/auth.js';

const program = new Command();

program
  .name('qce')
  .description('QQ Chat Exporter CLI - 导出 QQ 聊天记录')
  .version('0.37.0')
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
memoryCommand(program);
ttsCommand(program);
videoCommand(program);
singCommand(program);
songCommand(program);
proactiveCommand(program);
gateCommand(program);
memeCommand(program);
historyCommand(program);
backupCommand(program);
sendCommand(program);
toolsCommand(program);
dispatchCommand(program);
statusCommand(program);
monitorCommand(program);
qzoneCommand(program);
napcatCommand(program);
adminCommand(program);
friendCommand(program);
wsMonitorCommand(program);
setupCommand(program);
profileCommand(program);
replyCommand(program);
queueCommand(program);
groupBotCommand(program);
privateBotCommand(program);
faceCommand(program);
faceCommandExtended(program);
personaCommand(program);
accountCommand(program);

program.parse();
