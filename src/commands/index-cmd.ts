import { Command } from 'commander';
import chalk from 'chalk';
import { authManager } from '../core/auth.js';
import { fetchGroupMessages } from '../core/history.js';
import { MessageStore, defaultIndexRoot } from '../core/message-store.js';
import { VectorStore } from '../core/vector-store.js';
import { embedTexts, resolveApiKey } from '../core/embeddings.js';

function fmt(ts: number): string {
  if (!ts) return '—';
  const d = new Date(ts * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function indexCommand(program: Command): void {
  program
    .command('index [group]')
    .description('把群消息抓到本地索引（增量去重），之后 search / digest / mcp 直接读本地')
    .option('-n, --limit <number>', '本次最多拉取条数', '1000')
    .option('--all', '更新所有已入索引的群')
    .option('--stats', '只看索引概览')
    .option('--clear', '清空索引（配合 group 只清单群）')
    .option('--embed', '同时生成语义向量（阿里云百炼 text-embedding-v4，需 DASHSCOPE_API_KEY）')
    .option('--json', '输出 JSON')
    .action(async (group, options) => {
      const store = new MessageStore(defaultIndexRoot());

      if (options.clear) {
        const gid = group ? Number(group) : undefined;
        store.clear(gid);
        console.log(chalk.green(gid ? `已清空群 ${gid} 的索引` : '已清空全部索引'));
        return;
      }

      if (options.stats || (!group && !options.all)) {
        const stats = store.stats();
        if (options.json) {
          console.log(JSON.stringify({ root: store.root, groups: stats }, null, 2));
          return;
        }
        console.log(chalk.dim(`索引目录: ${store.root}`));
        if (stats.length === 0) {
          console.log(chalk.yellow('索引为空。先跑: qce index <群号>'));
          return;
        }
        console.log(chalk.cyan('群号\t条数\t最新'));
        for (const s of stats) console.log(`${s.groupId}\t${s.count}\t${fmt(s.newest)}`);
        console.log(chalk.dim(`合计 ${stats.reduce((a, b) => a + b.count, 0)} 条`));
        return;
      }

      if (!authManager.isConfigured()) {
        console.log(chalk.red('请先配置 NapCatQQ 连接'));
        console.log(chalk.dim('运行: qce login --host <host> --port <port>'));
        return;
      }

      const client = authManager.getClient();
      const limit = Number(options.limit) || 1000;

      let targets: number[] = [];
      if (options.all) {
        targets = store.stats().map((s) => s.groupId);
        if (targets.length === 0) {
          console.log(chalk.yellow('还没有任何群进过索引，先指定群号：qce index <群号>'));
          return;
        }
      } else {
        const gid = Number(group);
        if (!Number.isFinite(gid) || gid <= 0) {
          console.log(chalk.red('群号无效'));
          return;
        }
        targets = [gid];
      }

      const wantEmbed = options.embed === true;
      const apiKey = resolveApiKey();
      if (wantEmbed && !apiKey) {
        console.log(chalk.yellow('缺少 DASHSCOPE_API_KEY，本次只建文本索引，不生成向量'));
      }
      const vectors = new VectorStore(defaultIndexRoot());

      const results: Array<{ groupId: number; added: number; total: number; newest: number; embedded?: number }> = [];
      for (const gid of targets) {
        try {
          const messages = await fetchGroupMessages(client, gid, { limit });
          const { added, total } = store.merge(gid, messages);
          const newest = store.watermark(gid);
          let embedded = 0;
          if (wantEmbed && apiKey) {
            const docs = store.load(gid);
            const have = vectors.load(gid);
            const todo = docs.filter((d) => !have.has(d.id));
            if (todo.length > 0) {
              const vecs = await embedTexts(todo.map((d) => d.text || '（空消息）'), { apiKey });
              const r = vectors.upsert(gid, todo.map((d, i) => ({ id: d.id, vec: vecs[i] })));
              embedded = r.added;
            }
          }
          results.push({ groupId: gid, added, total, newest, ...(wantEmbed ? { embedded } : {}) });
          console.log(chalk.green(`群 ${gid}: +${added} 条（共 ${total}）  最新 ${fmt(newest)}` + (wantEmbed ? `  向量 +${embedded}` : '')));
        } catch (error) {
          console.log(chalk.red(`群 ${gid} 失败: ${(error as Error).message}`));
        }
      }

      if (options.json) console.log(JSON.stringify(results, null, 2));
    });
}
