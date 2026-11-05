import { Command } from 'commander';
import chalk from 'chalk';
import { authManager } from '../core/auth.js';
import { searchDocs, renderHits, type SearchDoc } from '../core/search-index.js';
import { fetchGroupMessages, parseDuration } from '../core/history.js';

export function searchCommand(program: Command): void {
  program
    .command('search <query>')
    .description('在本地 QQ 群聊记录里搜索（中文按二元组匹配，无需分词）')
    .option('-g, --group <id>', '只搜某个群')
    .option('--since <dur>', '时间范围，如 7d / 24h / 30m')
    .option('--from <qq>', '只看某个发送者')
    .option('-n, --limit <number>', '返回条数', '20')
    .option('--scan <number>', '最多拉取多少条历史用于匹配', '1000')
    .option('--json', '输出 JSON')
    .action(async (query, options) => {
      if (!authManager.isConfigured()) {
        console.log(chalk.red('请先配置 NapCatQQ 连接'));
        console.log(chalk.dim('运行: qce login --host <host> --port <port>'));
        return;
      }

      const groupId = options.group ? Number(options.group) : undefined;
      if (options.group && !Number.isFinite(groupId)) {
        console.log(chalk.red('--group 需要是群号'));
        return;
      }

      const client = authManager.getClient();
      const durationSec = parseDuration(options.since);
      const cutoff = durationSec ? Math.floor(Date.now() / 1000) - durationSec : 0;

      let docs: SearchDoc[] = [];

      if (groupId !== undefined) {
        const messages = await fetchGroupMessages(client, groupId, { limit: Number(options.scan), cutoff });
        docs = messages;
      } else {
        // 未指定群：扫前若干个群，每个拉一小段（避免一个群就把上限吃满）
        const groups: any[] = (await client.getGroupList()) as any[];
        const ids = (Array.isArray(groups) ? groups : [])
          .map((g: any) => Number(g.group_id))
          .filter((n: number) => Number.isFinite(n) && n > 0)
          .slice(0, 10);

        for (const gid of ids) {
          try {
            const messages = await fetchGroupMessages(client, gid, { limit: Math.min(200, Number(options.scan)), cutoff });
            docs.push(...messages);
          } catch {
            // 单群失败不影响整体
          }
        }
      }

      if (docs.length === 0) {
        console.log(chalk.yellow('没有取到可搜索的消息（群号是否正确？NapCat 是否缓存了历史？）'));
        return;
      }

      const hits = searchDocs(docs, query, {
        groupId,
        since: cutoff || undefined,
        senderId: options.from ? Number(options.from) : undefined,
        limit: Number(options.limit) || 20,
      });

      if (options.json) {
        console.log(JSON.stringify(hits, null, 2));
        return;
      }

      console.log(chalk.dim(`扫描 ${docs.length} 条消息，命中 ${hits.length} 条`));
      console.log();
      console.log(renderHits(hits));
    });
}
