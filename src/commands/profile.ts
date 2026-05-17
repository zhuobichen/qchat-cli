/**
 * 用户画像 CLI 命令
 * qce profile generate|regenerate|show|edit|list|delete
 */
import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { spawn } from 'child_process';
import { QZoneClient } from '../core/qzone-client.js';
import {
  loadProfile,
  saveProfile,
  deleteProfile,
  listProfiles,
  profileExists,
  getProfilePath,
  fetchFullChatHistory,
  generateProfile,
  formatFeedsForPrompt,
} from '../core/profile.js';

/** 尝试从 config 读取 DeepSeek API key */
function readApiKey(): string | null {
  const configPath = join(process.cwd(), 'private', 'config.json');
  try {
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      return config.deepseekApiKey || null;
    }
  } catch {}
  return null;
}

export function profileCommand(program: Command): void {
  const profile = program
    .command('profile')
    .description('用户画像管理（从聊天记录+空间说说生成）');

  // ─── generate ───────────────────────────────────────────
  profile
    .command('generate <uin>')
    .description('从聊天记录和空间说说生成用户画像')
    .option('-k, --api-key <key>', 'DeepSeek API Key（默认从 private/config.json 读取）')
    .option('--no-qzone', '跳过拉取空间说说（仅用聊天记录）')
    .action(async (uin, options) => {
      const apiKey = options.apiKey || readApiKey();
      if (!apiKey) {
        console.log(chalk.red('缺少 DeepSeek API Key'));
        console.log(chalk.dim('用 --api-key 指定，或在 private/config.json 中设置 deepseekApiKey'));
        return;
      }

      if (profileExists(uin)) {
        const existing = loadProfile(uin);
        console.log(chalk.yellow('画像已存在，内容预览:'));
        console.log(chalk.dim('─'.repeat(40)));
        console.log(existing.slice(0, 400));
        console.log(chalk.dim('─'.repeat(40)));
        console.log(chalk.dim('如需重新生成，请用 qce profile regenerate ' + uin));
        return;
      }

      await doGenerate(uin, apiKey, options.noQzone);
    });

  // ─── regenerate ────────────────────────────────────────
  profile
    .command('regenerate <uin>')
    .description('强制重新生成用户画像（会覆盖现有）')
    .option('-k, --api-key <key>', 'DeepSeek API Key')
    .option('--no-qzone', '跳过空间说说')
    .action(async (uin, options) => {
      const apiKey = options.apiKey || readApiKey();
      if (!apiKey) {
        console.log(chalk.red('缺少 DeepSeek API Key'));
        return;
      }

      if (profileExists(uin)) {
        console.log(chalk.yellow('⚠ 将覆盖现有画像'));
      }

      await doGenerate(uin, apiKey, options.noQzone);
    });

  // ─── show ──────────────────────────────────────────────
  profile
    .command('show <uin>')
    .description('查看用户画像')
    .action(async (uin) => {
      const content = loadProfile(uin);
      if (!content) {
        console.log(chalk.yellow(`未找到 ${uin} 的画像`));
        console.log(chalk.dim(`用 qce profile generate ${uin} 生成`));
        return;
      }
      console.log(content);
    });

  // ─── edit ──────────────────────────────────────────────
  profile
    .command('edit <uin>')
    .description('用编辑器打开画像文件')
    .action(async (uin) => {
      if (!profileExists(uin)) {
        console.log(chalk.yellow(`未找到 ${uin} 的画像，先生成一个吧`));
        return;
      }

      const filePath = getProfilePath(uin);
      const editor = process.env.EDITOR || process.env.VISUAL || (process.platform === 'win32' ? 'notepad' : 'vi');
      console.log(chalk.dim(`打开: ${filePath}`));
      spawn(editor, [filePath], { stdio: 'inherit', detached: true }).unref();
    });

  // ─── list ──────────────────────────────────────────────
  profile
    .command('list')
    .description('列出所有用户画像')
    .action(() => {
      const profiles = listProfiles();
      if (profiles.length === 0) {
        console.log(chalk.yellow('暂无画像'));
        console.log(chalk.dim('用 qce profile generate <QQ号> 生成'));
        return;
      }

      console.log(chalk.bold('\n📋 用户画像列表\n'));
      console.log(chalk.dim('─'.repeat(55)));
      for (const p of profiles) {
        const date = p.generatedAt !== 'unknown'
          ? new Date(p.generatedAt).toLocaleDateString('zh-CN')
          : 'unknown';
        const size = (p.size / 1024).toFixed(1);
        const source = p.source.includes('qzone') ? '聊天+空间' : '聊天';
        console.log(`  ${chalk.cyan(p.uin)}  ${chalk.dim(date)}  ${size}KB  [${source}]`);
      }
      console.log(chalk.dim('─'.repeat(55)));
      console.log(chalk.dim(`共 ${profiles.length} 个画像\n`));
    });

  // ─── delete ────────────────────────────────────────────
  profile
    .command('delete <uin>')
    .description('删除用户画像')
    .action(async (uin) => {
      if (!profileExists(uin)) {
        console.log(chalk.yellow(`未找到 ${uin} 的画像`));
        return;
      }
      deleteProfile(uin);
      console.log(chalk.green(`✓ 已删除 ${uin} 的画像`));
    });
}

async function doGenerate(uin: string, apiKey: string, skipQzone: boolean): Promise<void> {
  console.log('');
  console.log(chalk.bold.cyan(`🔍 生成用户画像 - ${uin}`));
  console.log(chalk.dim('─'.repeat(40)));
  console.log('');

  // Step 1: 拉取聊天记录
  const chatSpinner = ora('[1/3] 拉取完整聊天记录...').start();
  let chatMsgs: any[] = [];
  try {
    chatMsgs = await fetchFullChatHistory(uin, 1);
    chatSpinner.succeed(`[1/3] 聊天记录: ${chatMsgs.length} 条`);
  } catch (err: any) {
    chatSpinner.fail(`[1/3] 拉取聊天记录失败: ${err.message}`);
    if (chatMsgs.length === 0) {
      console.log(chalk.yellow('无法获取聊天记录，请确保 NapCat 已启动'));
      return;
    }
  }

  // Step 2: 拉取 QZone 说说
  let qzoneFeeds: any[] = [];
  if (!skipQzone) {
    const qzSpinner = ora('[2/3] 拉取空间说说...').start();
    try {
      const qz = new QZoneClient();
      qz.loadCookie();
      if (qz.loggedIn) {
        let pos = 0;
        const uid = parseInt(uin);
        while (true) {
          const feeds = await qz.getFeeds(uid, pos, 30);
          if (!feeds || feeds.length === 0) break;
          qzoneFeeds.push(...feeds);
          if (feeds.length < 30) break;
          pos += feeds.length;
        }
        qzSpinner.succeed(`[2/3] 空间说说: ${qzoneFeeds.length} 条`);
      } else {
        qzSpinner.warn('[2/3] QZone 未登录，跳过空间说说');
      }
    } catch {
      qzSpinner.warn('[2/3] QZone 获取失败，跳过空间说说');
    }
  } else {
    console.log(chalk.dim('[2/3] 已跳过空间说说'));
  }

  // Step 3: AI 生成画像
  const aiSpinner = ora('[3/3] AI 生成画像...').start();
  try {
    const content = await generateProfile(uin, uin, chatMsgs, qzoneFeeds, '', apiKey);
    saveProfile(uin, content);
    aiSpinner.succeed('[3/3] 画像已生成');
    console.log('');
    console.log(chalk.green.bold('✅ 画像已保存'));
    console.log(chalk.dim(`  文件: ${getProfilePath(uin)}`));
    console.log(chalk.dim(`  查看: qce profile show ${uin}`));
    console.log(chalk.dim(`  编辑: qce profile edit ${uin}`));
    console.log('');
    console.log(chalk.yellow('💡 AI 生成的画像是初稿，建议检查并手动补充资料'));
  } catch (err: any) {
    aiSpinner.fail(`[3/3] 生成失败: ${err.message}`);
  }
}
