import { Command } from 'commander';
import chalk from 'chalk';
import { authManager } from '../core/auth.js';
import { searchDocs, renderHits, type SearchDoc } from '../core/search-index.js';
import { fetchGroupMessages, parseDuration } from '../core/history.js';
import { MessageStore, defaultIndexRoot } from '../core/message-store.js';

export function searchCommand(program: Command): void {
  program
    .command('search <query>')
    .description('在本地 QQ 群聊记录里搜索（读本地索引，毫秒级；中文按二元组匹配）')
    .option('-g, --group <id>', '只搜某个群')
    .option('--since <dur>', '时间范围，如 7d / 24h / 30m')
    .option('--from <qq>', '只看某个发送者')
    .option('-n, --limit <number>', '返回条数', '20')
    .option('--scan <number>', '首次建索引时最多拉取多少条', '1000')
    .option('--refresh', '先从 OneBot 增量更新索引，再搜')
    .option('--json', '输出 JSON')
    .action(async (query, options) => {
      const store = new MessageStore(defaultIndexRoot());
      const groupId = options.group ? Number(options.group) : undefined;
      if (options.group && !Number.isFinite(groupId)) {
        console.log(chalk.red('--group 需要是群号'));
        return;
      }

      const durationSec = parseDuration(options.since);
      const cutoff = durationSec ? Math.floor(Date.now() / 1000) - durationSec : 0;
      const scan = Number(options.scan) || 1000;

      // 索引为空 / 显式 --refresh 时才联网；否则纯本地查询
      const needNetwork =
        options.refresh === true ||
        (groupId !== undefined ? store.load(groupId).length === 0 : store.loadAll().length === 0);

      if (needNetwork) {
        if (!authManager.isConfigured()) {
          console.log(chalk.red('索引为空，且还没配置 NapCatQQ 连接'));
          console.log(chalk.dim('运行: qce login --host <host> --port <port>'));
          return;
        }
        const client = authManager.getClient();

        if (groupId !== undefined) {
          const messages = await fetchGroupMessages(client, groupId, { limit: scan, cutoff });
          const { added } = store.merge(groupId, messages);
          console.log(chalk.dim(`索引更新：群 ${groupId} +${added} 条`));
        } else {
          const groups: any[] = (await client.getGroupList()) as any[];
          const ids = (Array.isArray(groups) ? groups : [])
            .map((g: any) => Number(g.group_id))
            .filter((n: number) => Number.isFinite(n) && n > 0)
            .slice(0, 10);
          for (const gid of ids) {
            try {
              const messages = await fetchGroupMessages(client, gid, { limit: Math.min(200, scan), cutoff });
              store.merge(gid, messages);
            } catch {
              // 单群失败不影响整体
            }
          }
          console.log(chalk.dim(`索引更新：扫描 ${ids.length} 个群`));
        }
      }

      const docs: SearchDoc[] =
        groupId !== undefined
          ? store.load(groupId)
          : store.loadAll();

      if (docs.length === 0) {
        console.log(chalk.yellow('本地索引为空。先建索引: qce index <群号>'));
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

      console.log(chalk.dim(`本地索引 ${docs.length} 条，命中 ${hits.length} 条`));
      console.log();
      console.log(renderHits(hits));
    });
}
