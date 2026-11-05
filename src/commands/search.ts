import { Command } from 'commander';
import chalk from 'chalk';
import { authManager } from '../core/auth.js';
import { searchDocs, renderHits, type SearchDoc } from '../core/search-index.js';
import { fetchGroupMessages, parseDuration } from '../core/history.js';
import { MessageStore, defaultIndexRoot } from '../core/message-store.js';
import { VectorStore } from '../core/vector-store.js';
import { embedTexts, resolveApiKey } from '../core/embeddings.js';

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
    .option('--semantic', '语义检索（需 DASHSCOPE_API_KEY，且已用 qce index --embed 建过向量）')
    .option('--min-score <number>', '语义检索的最低余弦相似度', '0.45')
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

      const limit = Number(options.limit) || 20;
      let hits = searchDocs(docs, query, {
        groupId,
        since: cutoff || undefined,
        senderId: options.from ? Number(options.from) : undefined,
        limit,
      });

      if (options.semantic) {
        const apiKey = resolveApiKey();
        if (!apiKey) {
          console.log(chalk.yellow('缺少 DASHSCOPE_API_KEY，退回关键词检索'));
        } else {
          try {
            const [queryVec] = await embedTexts([query], { apiKey });
            const vectors = new VectorStore(defaultIndexRoot());
            const byId = new Map(docs.map((d) => [d.id, d]));
            const ranked: typeof hits = [];
            const groups = groupId !== undefined
              ? [groupId]
              : [...new Set(docs.map((d) => d.groupId).filter((g): g is number => typeof g === 'number'))];
            for (const group of groups) {
              for (const hit of vectors.search(group, queryVec, limit * 3)) {
                const doc = byId.get(hit.id);
                if (!doc) continue;
                if (cutoff && doc.time < cutoff) continue;
                if (options.from && doc.senderId !== Number(options.from)) continue;
                ranked.push({ ...doc, score: hit.score, snippet: doc.text.slice(0, 80) });
              }
            }
            const minScore = Number(options.minScore);
            const filtered = ranked
              .filter((h) => h.score >= (Number.isFinite(minScore) ? minScore : 0.45))
              .sort((a, b) => b.score - a.score);
            if (filtered.length > 0) hits = filtered.slice(0, limit);
            else console.log(chalk.yellow(`语义检索无命中（阈值 ${minScore}），本次用关键词结果`));
          } catch (error) {
            console.log(chalk.yellow(`语义检索失败（${(error as Error).message}），退回关键词结果`));
          }
        }
      }

      if (options.json) {
        console.log(JSON.stringify(hits, null, 2));
        return;
      }

      console.log(chalk.dim(`本地索引 ${docs.length} 条，命中 ${hits.length} 条`));
      console.log();
      console.log(renderHits(hits));
    });
}
