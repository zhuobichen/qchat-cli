import { Command } from 'commander';
import chalk from 'chalk';
import { authManager } from '../core/auth.js';
import { resolveSession } from '../utils/resolveSession.js';
import {
  filterFiles, findFile, formatSize, renderFileTable, summarizeFiles, downloadFile, type FileEntry,
} from '../core/group-files.js';

async function listFiles(groupId: number): Promise<FileEntry[]> {
  const client = authManager.getClient();
  const info = await client.getGroupFileList(groupId);
  const files = (info?.files ?? []) as any[];
  return files.map((f) => ({
    size: Number(f.size) || 0,
    name: String(f.name ?? ''),
    fid: String(f.fid ?? f.file_id ?? ''),
    busid: Number(f.busid ?? 0),
    business_name: f.business_name,
    upload_time: Number(f.upload_time ?? 0),
  }));
}

export function filesCommand(program: Command): void {
  const files = program
    .command('files')
    .description('群文件：列表 / 搜索 / 下载 / 统计');

  files
    .command('list <group>')
    .description('列出群文件')
    .option('-n, --limit <number>', '最多显示条数', '50')
    .option('--json', '输出 JSON')
    .action(async (group, options) => {
      if (!authManager.isConfigured()) {
        console.log(chalk.red('请先配置 NapCatQQ 连接'));
        return;
      }
      try {
        const groupId = await resolveSession(group);
        const entries = await listFiles(groupId);
        if (options.json) {
          console.log(JSON.stringify(entries, null, 2));
          return;
        }
        const s = summarizeFiles(entries);
        console.log(chalk.cyan(`群 ${groupId} 文件：${s.count} 个，合计 ${formatSize(s.totalSize)}`));
        console.log(renderFileTable(entries, Number(options.limit) || 50));
      } catch (error) {
        console.log(chalk.red(`获取失败: ${(error as Error).message}`));
      }
    });

  files
    .command('search <keyword>')
    .description('在群文件里按文件名搜索（不给 --group 则扫所有群）')
    .option('-g, --group <id>', '只搜某个群')
    .option('--ext <ext>', '按扩展名过滤，如 pdf')
    .option('--min-size <bytes>', '最小字节数')
    .option('--json', '输出 JSON')
    .action(async (keyword, options) => {
      if (!authManager.isConfigured()) {
        console.log(chalk.red('请先配置 NapCatQQ 连接'));
        return;
      }
      try {
        const groups: number[] = [];
        if (options.group) {
          groups.push(await resolveSession(String(options.group)));
        } else {
          const list = (await authManager.getClient().getGroupList()) as any[];
          for (const g of list.slice(0, 20)) groups.push(Number(g.group_id));
        }

        const hits: Array<FileEntry & { groupId: number }> = [];
        for (const gid of groups) {
          try {
            const entries = await listFiles(gid);
            const matched = filterFiles(entries, {
              keyword,
              ext: options.ext,
              minSize: options.minSize ? Number(options.minSize) : undefined,
            });
            for (const f of matched) hits.push({ ...f, groupId: gid });
          } catch {
            // 单群失败不影响其它
          }
        }

        if (options.json) {
          console.log(JSON.stringify(hits, null, 2));
          return;
        }
        if (hits.length === 0) {
          console.log(chalk.yellow(`没有匹配「${keyword}」的文件`));
          return;
        }
        console.log(chalk.cyan(`命中 ${hits.length} 个文件（扫描 ${groups.length} 个群）`));
        for (const f of hits.slice(0, Number(options.limit) || 50)) {
          console.log(`  群${f.groupId}  ${formatSize(f.size).padStart(9)}  ${f.name}`);
        }
      } catch (error) {
        console.log(chalk.red(`搜索失败: ${(error as Error).message}`));
      }
    });

  files
    .command('download <group> <target>')
    .description('下载群文件（target 可以是文件名或 fid）')
    .option('-o, --output <dir>', '保存目录', './downloads')
    .action(async (group, target, options) => {
      if (!authManager.isConfigured()) {
        console.log(chalk.red('请先配置 NapCatQQ 连接'));
        return;
      }
      try {
        const groupId = await resolveSession(group);
        const entries = await listFiles(groupId);
        const file = findFile(entries, target);
        if (!file) {
          console.log(chalk.yellow(`没找到「${target}」；可先跑 qce files list ${groupId}`));
          return;
        }

        const client = authManager.getClient() as any;
        if (typeof client.getGroupFileUrl !== 'function') {
          console.log(chalk.red('当前 OneBot 实现不支持 get_group_file_url，无法下载'));
          return;
        }

        console.log(chalk.dim(`下载 ${file.name}（${formatSize(file.size)}）...`));
        const info = await client.getGroupFileUrl(groupId, file.fid, file.busid ?? 0);
        const url = info?.url ?? info?.data?.url;
        if (!url) {
          console.log(chalk.red('拿不到下载地址（NapCat 的 packetBackend 未启用时无法取文件 URL）'));
          return;
        }
        const saved = await downloadFile(url, options.output, file.name);
        console.log(chalk.green(`已保存: ${saved}`));
      } catch (error) {
        console.log(chalk.red(`下载失败: ${(error as Error).message}`));
      }
    });

  files
    .command('stats <group>')
    .description('群文件体积分布')
    .option('--json', '输出 JSON')
    .action(async (group, options) => {
      if (!authManager.isConfigured()) {
        console.log(chalk.red('请先配置 NapCatQQ 连接'));
        return;
      }
      try {
        const groupId = await resolveSession(group);
        const entries = await listFiles(groupId);
        const s = summarizeFiles(entries);
        if (options.json) {
          console.log(JSON.stringify(s, null, 2));
          return;
        }
        console.log(chalk.cyan(`群 ${groupId}：${s.count} 个文件，合计 ${formatSize(s.totalSize)}`));
        for (const e of s.byExt.slice(0, 10)) {
          console.log(`  ${e.ext.padEnd(10)} ${String(e.count).padStart(4)} 个  ${formatSize(e.size).padStart(9)}`);
        }
      } catch (error) {
        console.log(chalk.red(`统计失败: ${(error as Error).message}`));
      }
    });
}
