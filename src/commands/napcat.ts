/**
 * NapCatQQ 集成命令
 * 从 CLI 启动/停止/查看 NapCat + QQ（无需手动开 bat）
 */
import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { spawn, execSync } from 'child_process';
import { existsSync, writeFileSync, mkdirSync } from 'fs';
import { join, resolve, dirname } from 'path';
import http from 'http';
import os from 'os';
import { configManager } from '../config/index.js';

const DEFAULT_NAPCAT_DIR = (() => {
  // 优先使用配置保存的路径
  const configured = configManager.getNapcat().installDir;
  if (configured && existsSync(join(configured, 'NapCatWinBootMain.exe'))) {
    return configured;
  }
  // 兜底：常见路径
  for (const p of ['E:/CodeProject/NapCat.Shell', join(os.homedir(), '.qchat-cli', 'NapCat.Shell'), join(os.homedir(), 'NapCat.Shell')]) {
    if (existsSync(join(p, 'NapCatWinBootMain.exe'))) return p;
  }
  return resolve('E:/CodeProject/NapCat.Shell');
})();
const NAPCAT_PORT = 3000;
const POLL_INTERVAL_MS = 2000;
const STARTUP_TIMEOUT_MS = 180_000; // 3 分钟超时

/** 从注册表找 QQ 安装路径 */
function findQQPath(): string | null {
  try {
    const regKey = 'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\QQ';
    const result = execSync(`reg query "${regKey}" /v UninstallString`, {
      encoding: 'utf-8',
      windowsHide: true,
    });
    // 输出格式: "UninstallString    REG_SZ    C:\Program Files\..."
    const match = result.match(/REG_SZ\s+(.+)/);
    if (match) {
      const uninstPath = match[1].trim();
      // 从 UninstallString 路径提取 QQ 目录 → QQ.exe
      const qqDir = dirname(uninstPath);
      return join(qqDir, 'QQ.exe');
    }
  } catch {}
  return null;
}

function getNapCatUrl(host = '127.0.0.1', port = NAPCAT_PORT) {
  return `http://${host}:${port}`;
}

async function httpGet(url: string): Promise<any> {
  return new Promise((resolve, _reject) => {
    const req = http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(3000, () => { req.destroy(); resolve(null); });
  });
}

/** 检查 NapCat 是否运行中 */
async function checkNapCat(host: string, port: number) {
  const info = await httpGet(`${getNapCatUrl(host, port)}/get_login_info`);
  if (info?.status === 'ok' && info?.data) {
    return { running: true, nickname: info.data.nickname as string, userId: info.data.user_id as number };
  }
  return { running: false };
}

export function napcatCommand(program: Command): void {
  const napcat = program
    .command('napcat')
    .description('NapCatQQ 进程管理 (启动/停止/状态)');

  // ─── start ─────────────────────────────────────────────
  napcat
    .command('start')
    .description('启动 NapCat + QQ，等待扫码登录')
    .option('--path <dir>', `NapCat.Shell 目录`, DEFAULT_NAPCAT_DIR)
    .option('-H, --host <host>', 'OneBot 地址', '127.0.0.1')
    .option('-p, --port <port>', 'OneBot 端口', String(NAPCAT_PORT))
    .action(async (options) => {
      const napcatDir = resolve(options.path);
      const host = options.host;
      const port = parseInt(options.port);

      // 确保目录存在
      const launcherExe = join(napcatDir, 'NapCatWinBootMain.exe');
      const injectDll = join(napcatDir, 'NapCatWinBootHook.dll');
      const mainScript = join(napcatDir, 'napcat.mjs');

      if (!existsSync(launcherExe)) {
        console.log(chalk.red('NapCat.Shell 目录不完整，找不到 NapCatWinBootMain.exe'));
        console.log(chalk.dim(`目录: ${napcatDir}`));
        console.log(chalk.dim('请用 --path 指定正确的 NapCat.Shell 目录'));
        return;
      }

      // 查 QQ 安装路径
      const qqPath = findQQPath();
      if (!qqPath || !existsSync(qqPath)) {
        console.log(chalk.red('找不到 QQ 安装路径'));
        console.log(chalk.dim('请确认 QQ 已安装'));
        return;
      }

      // 先检查是否已在运行
      const existing = await checkNapCat(host, port);
      if (existing.running) {
        console.log(chalk.green(`NapCat 已在运行 — ${existing.nickname} (${existing.userId})`));
        return;
      }

      console.log(chalk.bold('启动 NapCat + QQ...'));
      console.log(chalk.dim(`NapCat: ${napcatDir}`));
      console.log(chalk.dim(`QQ:     ${qqPath}`));
      console.log('');

      // 设置 NapCat 环境变量
      const env: Record<string, string> = {
        ...(process.env as Record<string, string>),
        NAPCAT_PATCH_PACKAGE: join(napcatDir, 'qqnt.json'),
        NAPCAT_LOAD_PATH: join(napcatDir, 'loadNapCat.js'),
        NAPCAT_INJECT_PATH: injectDll,
        NAPCAT_LAUNCHER_PATH: launcherExe,
        NAPCAT_MAIN_PATH: mainScript.replace(/\\/g, '/'),
      };

      // 创建 loadNapCat.js（NapCat 启动脚本）
      const loadScript = `(async () => {await import("file:///${mainScript.replace(/\\/g, '/')}")})()`;
      writeFileSync(env.NAPCAT_LOAD_PATH, loadScript);

      // 启动 NapCat（注入 QQ）
      const proc = spawn(launcherExe, [qqPath, injectDll], {
        cwd: napcatDir,
        env,
        stdio: 'pipe',
      });

      // 打印 NapCat 输出，提取二维码并自动弹出
      let qrUrl = '';
      let qrImage = '';
      let qrOpened = false;

      proc.stdout?.on('data', (data: Buffer) => {
        const text = data.toString('utf-8').replace(/[^\x20-\x7E\u4e00-\u9fff\n\r:/?&=._\-]/g, '');
        if (!text.trim()) return;
        // 提取二维码 URL
        const urlMatch = text.match(/https?:\/\/txz\.qq\.com\/[^\s]+/);
        if (urlMatch && !qrUrl) {
          qrUrl = urlMatch[0];
          console.log(chalk.cyan('\n📱 扫码链接:'), chalk.underline(qrUrl));
        }
        // 提取二维码图片路径
        const imgMatch = text.match(/([A-Z]:[^,\s]*qrcode[^,\s]*\.png)/i);
        if (imgMatch && !qrImage) {
          qrImage = imgMatch[1];
        }
        // 自动弹出二维码图片窗口
        if (qrImage && !qrOpened) {
          qrOpened = true;
          try {
            spawn('cmd', ['/c', 'start', '', qrImage], { stdio: 'ignore', detached: true }).unref();
            console.log(chalk.green('✓ 二维码已弹出，请用手机 QQ 扫描'));
            console.log(chalk.dim(`  图片: ${qrImage}`));
          } catch {}
        }
      });

      proc.stderr?.on('data', (_data: Buffer) => {});

      proc.on('error', (_err) => {});

      // 不等待进程退出（NapCatWinBootMain 启动 QQ 后可能自己退出）
      proc.unref();

      console.log(chalk.yellow('等待 QQ 弹出登录窗口...'));
      console.log('');

      // 兜底：等待 3 秒后检查固定路径的二维码图片
      setTimeout(() => {
        if (!qrOpened) {
          const cacheQr = join(napcatDir, 'cache', 'qrcode.png');
          if (existsSync(cacheQr)) {
            qrImage = cacheQr;
            qrOpened = true;
            try {
              spawn('cmd', ['/c', 'start', '', cacheQr], { stdio: 'ignore', detached: true }).unref();
              console.log(chalk.green('✓ 二维码已弹出，请用手机 QQ 扫描'));
            } catch {}
          }
        }
      }, 3000);

      // 轮询等待 OneBot 就绪
      const spinner = ora('等待扫码...').start();
      const startTime = Date.now();
      let ready = false;

      while (Date.now() - startTime < STARTUP_TIMEOUT_MS) {
        const info = await httpGet(`${getNapCatUrl(host, port)}/get_login_info`);
        if (info?.data?.nickname) {
          ready = true;
          break;
        }
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      }

      if (ready) {
        const info = await httpGet(`${getNapCatUrl(host, port)}/get_login_info`);
        spinner.succeed(`登录成功 — ${info.data.nickname} (${info.data.user_id})`);

        // 检查 qce-bridge
        const bridge = await httpGet(`http://${host}:3001/health`);
        if (bridge?.ok) {
          console.log(chalk.green('✓ qce-bridge :3001 就绪'));
        } else {
          console.log(chalk.yellow('⚠ qce-bridge :3001 未就绪'));
        }
      } else {
        spinner.fail('登录超时（3 分钟）');
        console.log(chalk.dim('可能原因：扫码失败、QQ 已在运行、或 NapCat 目录有误'));
        console.log(chalk.dim('用 qce napcat status 查看状态'));
      }
    });

  // ─── stop ──────────────────────────────────────────────
  napcat
    .command('stop')
    .description('停止 NapCat + QQ 进程')
    .action(() => {
      console.log('正在停止 QQ/NapCat...');
      const toKill = ['QQ.exe', 'NapCatWinBootMain.exe'];
      let killed = 0;
      for (const name of toKill) {
        try {
          execSync(`taskkill /F /IM ${name} 2>nul`, { stdio: 'ignore' });
          console.log(chalk.dim(`  ${name}`));
          killed++;
        } catch {}
      }
      console.log(killed > 0 ? chalk.green('已停止') : chalk.yellow('未找到运行中的进程'));
    });

  // ─── status ────────────────────────────────────────────
  napcat
    .command('status')
    .description('查看 NapCat 运行状态')
    .option('-H, --host <host>', 'OneBot 地址', '127.0.0.1')
    .option('-p, --port <port>', 'OneBot 端口', String(NAPCAT_PORT))
    .action(async (options) => {
      const host = options.host;
      const port = parseInt(options.port);
      const nc = await checkNapCat(host, port);
      let bridgeOk = false;
      try {
        const b = await httpGet(`http://${host}:3001/health`);
        bridgeOk = b?.ok === true;
      } catch {}

      console.log('');
      console.log(chalk.bold('NapCat 状态'));
      console.log('─'.repeat(30));
      console.log(`  OneBot :${port}   ${nc.running ? chalk.green('● 在线  ' + nc.nickname + ' (' + nc.userId + ')') : chalk.red('● 离线')}`);
      console.log(`  Bridge :3001   ${bridgeOk ? chalk.green('● 在线') : chalk.red('● 离线')}`);
      console.log('─'.repeat(30));
      console.log('');
      if (!nc.running) console.log(chalk.dim('使用 qce napcat start 启动'));
    });
}
