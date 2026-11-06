import { Command } from 'commander';
import chalk from 'chalk';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseHistoryFile, queryHistory, renderHistory } from '../core/historyfile.js';

export function historyCommand(program: Command): void {
  program
    .command('history <group>')
    .description('读导出文件里的完整群历史（不依赖账号在线）')
    .option('-f, --file <path>', '历史文件路径（默认 output/group-<群号>-full.txt）')
    .option('-s, --search <keyword>', '按关键词过滤')
    .option('--from <qq>', '只看某人')
    .option('--since <yyyy-mm-dd>', '起始日期')
    .option('--until <yyyy-mm-dd>', '结束日期')
    .option('-n, --limit <n>', '最多输出条数')
    .option('--last <n>', '只要最后 N 条')
    .option('--json', '输出 JSON')
    .action((group, options) => {
      const file = options.file ?? join('output', `group-${group}-full.txt`);
      if (!existsSync(file)) {
        console.log(chalk.red(`找不到历史文件：${file}`));
        console.log(chalk.dim(`导出一份：qce export ${group} --format txt --all`));
        return;
      }

      const parsed = parseHistoryFile(readFileSync(file, 'utf8'));
      const toTs = (s?: string) => {
        if (!s) return undefined;
        const t = Math.floor(new Date(`${s}T00:00:00`).getTime() / 1000);
        return Number.isFinite(t) ? t : undefined;
      };

      const sinceTs = toTs(options.since);
      const untilTs = toTs(options.until);
      const hits = queryHistory(parsed.records, {
        ...(options.search ? { search: String(options.search) } : {}),
        ...(options.from ? { from: Number(options.from) } : {}),
        ...(sinceTs !== undefined ? { since: sinceTs } : {}),
        ...(untilTs !== undefined ? { until: untilTs + 86399 } : {}),
        ...(options.last ? { last: Number(options.last) } : {}),
        ...(options.limit ? { limit: Number(options.limit) } : {}),
      });

      if (options.json) {
        console.log(JSON.stringify({ file, total: parsed.records.length, hits }, null, 2));
        return;
      }
      console.log(chalk.cyan(`文件 ${file}`));
      console.log(chalk.dim(`共 ${parsed.records.length} 条，命中 ${hits.length} 条`));
      console.log();
      console.log(renderHistory(hits));
    });
}
