/**
 * 一键初始化命令
 * 自动检测/下载 NapCat，配置连接，完成所有初始化
 */
import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { existsSync, mkdirSync, createWriteStream, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { execSync } from 'child_process';
import os from 'os';
import { configManager } from '../config/index.js';
import { authManager } from '../core/auth.js';

const NAPCAT_REPO = 'NapNeko/NapCatQQ';
const DEFAULT_NAPCAT_INSTALL_DIR = join(os.homedir(), '.qchat-cli', 'NapCat.Shell');

/** 常见的 NapCat 安装路径 */
const COMMON_NAPCAT_PATHS = [
  'E:/CodeProject/NapCat.Shell',
  join(os.homedir(), 'NapCat.Shell'),
  join(os.homedir(), '.qchat-cli', 'NapCat.Shell'),
  'C:/NapCat.Shell',
  'D:/NapCat.Shell',
];

/** 检查目录是否包含 NapCat.Shell（含 NapCatWinBootMain.exe） */
function isValidNapCatDir(dir: string): boolean {
  return existsSync(join(dir, 'NapCatWinBootMain.exe'));
}

/** 查找已安装的 NapCat */
function findNapCat(): string | null {
  // 先检查配置中保存的路径
  const configured = configManager.getNapcat().installDir;
  if (configured && isValidNapCatDir(configured)) {
    return configured;
  }

  // 搜索常见路径
  for (const p of COMMON_NAPCAT_PATHS) {
    if (isValidNapCatDir(p)) {
      return resolve(p);
    }
  }

  return null;
}

/** GitHub API 获取最新 release */
async function fetchLatestRelease(): Promise<{
  tag: string;
  downloadUrl: string;
  assetName: string;
} | null> {
  try {
    const resp = await fetch(
      `https://api.github.com/repos/${NAPCAT_REPO}/releases/latest`,
      { headers: { 'User-Agent': 'qchat-cli' } }
    );
    if (!resp.ok) return null;

    const release = await resp.json() as any;

    // 查找 Windows x64 包：优先 Shell 版本
    const patterns = [/win.*shell/i, /Shell.*win/i, /NapCat\.Shell/i];
    let asset: any = null;

    for (const pattern of patterns) {
      asset = release.assets.find((a: any) => pattern.test(a.name) && a.name.endsWith('.zip'));
      if (asset) break;
    }

    // 退而求其次：任意 win x64 zip
    if (!asset) {
      asset = release.assets.find(
        (a: any) => /win/i.test(a.name) && /x64|x86_64|win32/i.test(a.name) && a.name.endsWith('.zip')
      );
    }

    if (!asset) return null;

    return {
      tag: release.tag_name,
      downloadUrl: asset.browser_download_url,
      assetName: asset.name,
    };
  } catch {
    return null;
  }
}

/** 下载文件（带进度显示） */
async function downloadFile(url: string, destPath: string): Promise<boolean> {
  const spinner = ora('下载中...').start();
  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      spinner.fail(`下载失败: HTTP ${resp.status}`);
      return false;
    }

    const total = parseInt(resp.headers.get('content-length') || '0', 10);
    const reader = resp.body?.getReader();
    if (!reader) {
      spinner.fail('无法读取响应流');
      return false;
    }

    // 确保目录存在
    const destDir = join(destPath, '..');
    if (!existsSync(destDir)) {
      mkdirSync(destDir, { recursive: true });
    }

    // 流式写入文件
    const fileStream = createWriteStream(destPath);
    let downloaded = 0;
    const chunks: Uint8Array[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      downloaded += value.length;

      if (total > 0) {
        const pct = ((downloaded / total) * 100).toFixed(0);
        const mb = (downloaded / 1024 / 1024).toFixed(1);
        spinner.text = `下载中... ${pct}% (${mb} MB)`;
      } else {
        const mb = (downloaded / 1024 / 1024).toFixed(1);
        spinner.text = `下载中... ${mb} MB`;
      }
    }

    // 写入磁盘
    const buffer = Buffer.concat(chunks);
    fileStream.write(buffer);
    fileStream.end();

    spinner.succeed(`下载完成 (${(downloaded / 1024 / 1024).toFixed(1)} MB)`);
    return true;
  } catch (err: any) {
    spinner.fail(`下载失败: ${err.message}`);
    return false;
  }
}

/** 解压 zip */
function extractZip(zipPath: string, destDir: string): boolean {
  const spinner = ora('解压中...').start();
  try {
    if (!existsSync(destDir)) {
      mkdirSync(destDir, { recursive: true });
    }

    // Windows 用 PowerShell Expand-Archive
    execSync(
      `powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force"`,
      { stdio: 'pipe', timeout: 120000 }
    );

    // 检查是否有嵌套目录（常见：解压后所有文件在一个子目录里）
    const entries = readdirSync(destDir);
    const innerDir = entries.find(
      (e) => !e.startsWith('.') && existsSync(join(destDir, e)) && !e.endsWith('.zip')
    );

    // 如果只有一个子目录且包含关键文件，认为它是一层嵌套，将其内容提升
    if (innerDir) {
      const inner = join(destDir, innerDir);
      if (
        existsSync(join(inner, 'NapCatWinBootMain.exe')) ||
        existsSync(join(inner, 'napcat.mjs'))
      ) {
        // 移动子目录内容到目标目录
        execSync(
          `powershell -Command "Get-ChildItem -Path '${inner}' | Move-Item -Destination '${destDir}' -Force"`,
          { stdio: 'pipe' }
        );
        execSync(`powershell -Command "Remove-Item -Path '${inner}' -Recurse -Force -ErrorAction SilentlyContinue"`, {
          stdio: 'pipe',
        });
      }
    }

    spinner.succeed('解压完成');
    return true;
  } catch (err: any) {
    spinner.fail(`解压失败: ${err.message}`);
    return false;
  }
}

/** 测试 NapCat 是否可运行 */
function verifyNapCat(dir: string): string[] {
  const required = ['NapCatWinBootMain.exe', 'NapCatWinBootHook.dll', 'napcat.mjs'];
  const missing = required.filter((f) => !existsSync(join(dir, f)));
  return missing;
}

export function setupCommand(program: Command): void {
  program
    .command('setup')
    .description('一键初始化：检测/下载 NapCat、配置连接')
    .option('--napcat-dir <dir>', '指定 NapCat.Shell 目录（跳过下载）')
    .option('--skip-download', '跳过下载，仅配置连接')
    .action(async (options) => {
      console.log('');
      console.log(chalk.bold.cyan('⚡ qchat-cli 一键初始化'));
      console.log(chalk.dim('─'.repeat(40)));
      console.log('');

      // ─── 第 1 步：检测/安装 NapCat ───
      console.log(chalk.bold('[1/3] NapCatQQ'));

      let napcatDir: string | null = null;

      if (options.napcatDir) {
        // 用户指定路径
        napcatDir = resolve(options.napcatDir);
        if (!isValidNapCatDir(napcatDir)) {
          console.log(chalk.red(`指定目录不包含 NapCatWinBootMain.exe: ${napcatDir}`));
          return;
        }
        console.log(chalk.green(`✓ 使用指定路径: ${napcatDir}`));
      } else {
        napcatDir = findNapCat();

        if (napcatDir) {
          console.log(chalk.green(`✓ 已找到 NapCat: ${napcatDir}`));
        } else if (options.skipDownload) {
          console.log(chalk.yellow('⚠ 未找到 NapCat（--skip-download 跳过）'));
        } else {
          console.log(chalk.yellow('未找到 NapCat，正在从 GitHub 下载...'));
          console.log('');

          // 下载
          const release = await fetchLatestRelease();
          if (!release) {
            console.log(chalk.red('无法获取 NapCat 最新版本信息'));
            console.log(chalk.dim('请手动下载: https://github.com/NapNeko/NapCatQQ/releases'));
            console.log(chalk.dim(`解压到: ${DEFAULT_NAPCAT_INSTALL_DIR}`));
            console.log(chalk.dim('然后用 --napcat-dir 指定路径'));
            return;
          }

          console.log(chalk.dim(`  版本: ${release.tag}`));
          console.log(chalk.dim(`  文件: ${release.assetName}`));

          const zipPath = join(os.tmpdir(), release.assetName);
          const ok = await downloadFile(release.downloadUrl, zipPath);
          if (!ok) return;

          // 解压
          const extracted = extractZip(zipPath, DEFAULT_NAPCAT_INSTALL_DIR);
          if (!extracted) return;

          // 验证
          const missing = verifyNapCat(DEFAULT_NAPCAT_INSTALL_DIR);
          if (missing.length > 0) {
            console.log(chalk.red(`安装不完整，缺少: ${missing.join(', ')}`));
            console.log(chalk.dim(`请检查: ${DEFAULT_NAPCAT_INSTALL_DIR}`));
            return;
          }

          napcatDir = DEFAULT_NAPCAT_INSTALL_DIR;
          console.log(chalk.green(`✓ 安装成功: ${napcatDir}`));
        }
      }

      // 保存 NapCat 路径到配置
      if (napcatDir) {
        configManager.updateNapcat({ installDir: napcatDir });
      }

      console.log('');

      // ─── 第 2 步：配置连接 ───
      console.log(chalk.bold('[2/3] OneBot 连接'));

      const currentConn = authManager.getConfig();
      if (currentConn.host && currentConn.port) {
        console.log(chalk.green(`✓ 已配置: ${currentConn.host}:${currentConn.port}`));
      } else {
        // 使用默认配置
        authManager.updateConfig({ host: '127.0.0.1', port: 3000 });
        console.log(chalk.green('✓ 使用默认配置: 127.0.0.1:3000'));
      }

      console.log('');

      // ─── 第 3 步：检查 qce-bridge ───
      console.log(chalk.bold('[3/3] qce-bridge 插件'));

      if (napcatDir) {
        const bridgeDir = join(napcatDir, 'plugins', 'qce-bridge');
        if (existsSync(bridgeDir)) {
          console.log(chalk.green(`✓ qce-bridge 已安装: ${bridgeDir}`));
        } else {
          console.log(chalk.yellow('⚠ 未检测到 qce-bridge 插件'));
          console.log(chalk.dim('  它是 NapCat 插件，用于突破 200 条消息限制'));
          console.log(chalk.dim(`  请放入: ${bridgeDir}`));
        }
      }

      // ─── 汇总 ───
      console.log('');
      console.log(chalk.dim('─'.repeat(40)));
      console.log(chalk.bold.green('✅ 初始化完成！'));
      console.log('');
      console.log('  接下来你可以:');
      console.log(`  ${chalk.cyan('qce napcat start')}    — 启动 NapCat + QQ`);
      console.log(`  ${chalk.cyan('qce napcat status')}   — 查看运行状态`);
      console.log(`  ${chalk.cyan('qce login --test')}     — 测试连接`);
      console.log(`  ${chalk.cyan('qce --help')}          — 查看所有命令`);
      console.log('');
    });
}
