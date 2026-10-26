/**
 * NapCatQQ 集成命令
 * 从 CLI 启动/停止/查看 NapCat + QQ（无需手动开 bat）
 */
import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { spawn, execSync } from 'child_process';
import { existsSync, writeFileSync, readFileSync, readdirSync, mkdirSync } from 'fs';
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
  return resolve(join(os.homedir(), '.qchat-cli', 'NapCat.Shell', 'napcat'));
})();
const NAPCAT_PORT = 3000;
const POLL_INTERVAL_MS = 2000;
const STARTUP_TIMEOUT_MS = 180_000; // 3 分钟超时

/** 从注册表找 QQ 安装路径 */
function findQQPath(): string | null {
  const knownPaths = ['C:/QQ/QQ.exe', 'C:/Program Files/Tencent/QQ/QQ.exe'];
  for (const qqPath of knownPaths) {
    if (existsSync(qqPath)) return qqPath;
  }
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

/**
 * 写入/更新指定账号的 OneBot HTTP 端口配置（config/onebot11_<uin>.json）。
 * 多开时每个账号必须用不同端口；返回 true 表示文件被修改。
 * 处理三种情况：文件不存在 / NapCat 新建的空 httpServers / 已有条目仅端口不同。
 */
function writeOnebotPort(napcatDir: string, uin: string | number, port: number): boolean {
  const file = join(napcatDir, 'config', `onebot11_${uin}.json`);
  let cfg: any = null;
  if (existsSync(file)) {
    try { cfg = JSON.parse(readFileSync(file, 'utf-8')); } catch { cfg = null; }
  }
  if (!cfg?.network) {
    cfg = {
      network: {
        httpServers: [],
        httpSseServers: [],
        httpClients: [],
        websocketServers: [],
        websocketClients: [],
        plugins: [],
      },
      musicSignUrl: '',
      enableLocalFile2Url: false,
      parseMultMsg: false,
      imageDownloadProxy: '',
      timeout: { baseTimeout: 10000, uploadSpeedKBps: 256, downloadSpeedKBps: 256, maxTimeout: 1800000 },
    };
  }
  if (!Array.isArray(cfg.network.httpServers)) cfg.network.httpServers = [];

  let changed = false;
  const server = cfg.network.httpServers[0];
  if (!server) {
    cfg.network.httpServers.push({
      enable: true,
      name: 'HTTP-API',
      host: '127.0.0.1',
      port,
      enableCors: true,
      enableWebsocket: false,
      messagePostFormat: 'array',
      token: '',
      debug: false,
    });
    changed = true;
  } else if (server.port !== port) {
    server.port = port;
    changed = true;
  }
  if (!changed) return false;

  mkdirSync(join(napcatDir, 'config'), { recursive: true });
  writeFileSync(file, JSON.stringify(cfg, null, 2), 'utf-8');
  return true;
}

/** 按命令行匹配目录，定向停止某个 NapCat 实例（含其拉起的 QQ 进程树） */
function stopNapcatByDir(dir: string): number {
  // PS 单引号字符串里反斜杠是字面量，只需处理单引号
  const escaped = dir.replace(/'/g, "''");
  const ps = `Get-CimInstance Win32_Process -Filter "Name='NapCatWinBootMain.exe'" | ` +
    `Where-Object { $_.CommandLine -like '*${escaped}*' } | ` +
    `Select-Object -ExpandProperty ProcessId`;
  let out = '';
  try {
    out = execSync(`powershell -NoProfile -Command "${ps.replace(/"/g, '\\"')}"`, { encoding: 'utf-8', windowsHide: true });
  } catch { return 0; }
  const pids = out.split(/\r?\n/).map((s) => s.trim()).filter((s) => /^\d+$/.test(s));
  let killed = 0;
  for (const pid of pids) {
    try {
      execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' });
      killed++;
    } catch {}
  }
  return killed;
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
    .option('-q, --qq <uin>', '指定 QQ 号快速登录（并预置该账号的 OneBot 端口配置）')
    .action(async (options) => {
      const requestedDir = resolve(options.path);
      const napcatDir = existsSync(join(requestedDir, 'NapCatWinBootMain.exe'))
        ? requestedDir
        : join(requestedDir, 'napcat');
      const host = options.host;
      const port = parseInt(options.port);
      const uin = options.qq ? String(options.qq).trim() : '';

      if (uin && !/^\d{5,12}$/.test(uin)) {
        console.log(chalk.red('QQ 号格式无效（5-12 位数字）'));
        return;
      }

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
      if (uin) console.log(chalk.dim(`账号:   ${uin}（OneBot :${port}）`));
      console.log('');

      // 指定账号时预写 OneBot 端口，首次登录即绑定正确端口，避免多开撞 3000
      if (uin) writeOnebotPort(napcatDir, uin, port);

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

      // 启动 NapCat（注入 QQ；-q 指定账号快速登录）
      const spawnArgs = uin ? [qqPath, injectDll, '-q', uin] : [qqPath, injectDll];
      const proc = spawn(launcherExe, spawnArgs, {
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

      // 轮询等待登录：
      //  a) OneBot :port 的 get_login_info 返回目标账号（实例已绑定正确端口，如 --qq 预置过配置）
      //  b) 首次扫码（未指定 --qq）：新实例可能绑不上默认端口（3000 被主实例占用），
      //     不能轮询 3000——会误读到别的实例；改为检测 config/napcat_<uin>.json 的新增
      const configDir = join(napcatDir, 'config');
      const uinFileRe = /^napcat_(\d+)\.json$/;
      const knownUins = new Set<string>();
      try {
        for (const f of readdirSync(configDir)) {
          const m = f.match(uinFileRe);
          if (m) knownUins.add(m[1]);
        }
      } catch {}

      const spinner = ora(uin ? `等待账号 ${uin} 登录...` : '等待扫码...').start();
      const startTime = Date.now();
      let ready = false;
      let firstLoginUin = '';

      while (Date.now() - startTime < STARTUP_TIMEOUT_MS) {
        const info = await httpGet(`${getNapCatUrl(host, port)}/get_login_info`);
        const infoUin = info?.data?.user_id ? String(info.data.user_id) : '';
        if (info?.data?.nickname && (!uin || infoUin === uin)) {
          ready = true;
          break;
        }
        if (!uin) {
          try {
            const newcomer = readdirSync(configDir).find((f) => {
              const m = f.match(uinFileRe);
              return !!m && !knownUins.has(m[1]);
            });
            if (newcomer) {
              firstLoginUin = newcomer.match(uinFileRe)![1];
              ready = true;
              break;
            }
          } catch {}
        }
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      }

      if (ready) {
        let loggedInUin = firstLoginUin;
        if (!firstLoginUin) {
          const info = await httpGet(`${getNapCatUrl(host, port)}/get_login_info`);
          loggedInUin = String(info.data.user_id);
          spinner.succeed(`登录成功 — ${info.data.nickname} (${info.data.user_id})`);
        } else {
          spinner.succeed(`检测到新账号 ${firstLoginUin} 扫码登录`);
        }

        // 首次扫码（未指定 --qq）时，把该账号的 OneBot 端口固化为 --port
        if (!uin) {
          const changed = writeOnebotPort(napcatDir, loggedInUin, port);
          if (changed) {
            console.log(chalk.yellow(`⚠ 已把账号 ${loggedInUin} 的 OneBot 端口写入 :${port}，重启后生效：`));
            console.log(chalk.dim(`  qce napcat stop --path "${napcatDir}"`));
            console.log(chalk.dim(`  qce napcat start --path "${napcatDir}" --port ${port} --qq ${loggedInUin}`));
          }
        }

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
    .description('停止 NapCat + QQ 进程（多开时建议用 --path 只停一个实例）')
    .option('--path <dir>', '只停止该 NapCat.Shell 目录对应的实例')
    .action((options) => {
      if (options.path) {
        const requestedDir = resolve(options.path);
        const napcatDir = existsSync(join(requestedDir, 'NapCatWinBootMain.exe'))
          ? requestedDir
          : join(requestedDir, 'napcat');
        console.log(`正在停止实例 ${napcatDir} ...`);
        const killed = stopNapcatByDir(napcatDir);
        console.log(killed > 0 ? chalk.green(`已停止 ${killed} 个实例`) : chalk.yellow('未找到该目录对应的运行中实例'));
        return;
      }

      console.log('正在停止所有 QQ/NapCat 实例（全部账号）...');
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
      console.log(chalk.dim('提示：多开环境下只想停一个实例，用 qce napcat stop --path <目录>'));
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
