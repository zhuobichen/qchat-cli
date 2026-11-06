import { Command } from 'commander';
import chalk from 'chalk';
import { MemoryStore, recallMemories, filterByKeyword, renderMemories, isExpired } from '../core/memory.js';
import { defaultIndexRoot } from '../core/message-store.js';

export function memoryCommand(program: Command): void {
  const mem = program
    .command('memory')
    .description('会淡忘的长期记忆：记住 / 召回 / 遗忘 / 清理');

  mem
    .command('add <text>')
    .description('记住一件事（同内容幂等）')
    .option('-s, --scope <id>', '归属范围：群号或 QQ 号', 'global')
    .option('-w, --weight <n>', '重要度 0-1', '0.7')
    .option('--days <n>', '多少天后过期（默认 180）')
    .action((text, options) => {
      const store = new MemoryStore(defaultIndexRoot());
      const now = Math.floor(Date.now() / 1000);
      const weight = Math.min(1, Math.max(0, Number(options.weight) || 0.7));
      const expiresAt = options.days ? now + Number(options.days) * 86400 : undefined;
      const { record, added } = store.remember({
        scope: String(options.scope),
        text: String(text),
        createdAt: now,
        weight,
        ...(expiresAt ? { expiresAt } : {}),
      });
      console.log(added ? chalk.green(`已记住 ${record.id}`) : chalk.yellow(`这条已经记过了（${record.id}）`));
    });

  mem
    .command('recall [keyword]')
    .description('按当前权重召回最要紧的几条（越久越淡）')
    .option('-s, --scope <id>', '只看某个范围')
    .option('-n, --limit <n>', '条数', '5')
    .action((keyword, options) => {
      const store = new MemoryStore(defaultIndexRoot());
      let records = store.load();
      if (keyword) records = filterByKeyword(records, String(keyword));
      const hits = recallMemories(records, {
        limit: Number(options.limit) || 5,
        ...(options.scope ? { scope: String(options.scope) } : {}),
      });
      if (hits.length === 0) {
        console.log(chalk.yellow('没有可召回的记忆'));
        return;
      }
      console.log(renderMemories(hits));
    });

  mem
    .command('list')
    .description('列出全部记忆（含已淡到最低的）')
    .option('--json', '输出 JSON')
    .action((options) => {
      const store = new MemoryStore(defaultIndexRoot());
      const records = store.load();
      if (options.json) {
        console.log(JSON.stringify(records, null, 2));
        return;
      }
      if (records.length === 0) {
        console.log(chalk.yellow('还没有任何记忆'));
        return;
      }
      const now = Math.floor(Date.now() / 1000);
      for (const r of records) {
        const expired = isExpired(r, { now });
        const ageDays = Math.max(0, Math.floor((now - r.createdAt) / 86400));
        console.log(`${expired ? chalk.dim('[已过期] ') : ''}${r.id}  ${r.scope}  ${ageDays}天前  w=${r.weight}`);
        console.log(chalk.dim(`  ${r.text.slice(0, 80)}`));
      }
    });

  mem
    .command('forget [id]')
    .description('忘掉一条（给 id）或清理所有过期记忆')
    .action((id) => {
      const store = new MemoryStore(defaultIndexRoot());
      if (!id) {
        const n = store.prune();
        console.log(chalk.green(`已清理 ${n} 条过期记忆`));
        return;
      }
      const records = store.load().filter((r) => r.id !== String(id));
      store.save(records);
      console.log(chalk.green(`已忘掉 ${id}`));
    });

  mem
    .command('stats')
    .description('记忆概况')
    .action(() => {
      const store = new MemoryStore(defaultIndexRoot());
      const records = store.load();
      const now = Math.floor(Date.now() / 1000);
      const expired = records.filter((r) => isExpired(r, { now })).length;
      console.log(chalk.cyan(`记忆 ${records.length} 条，其中已过期 ${expired} 条`));
      const byScope = new Map<string, number>();
      for (const r of records) byScope.set(r.scope, (byScope.get(r.scope) ?? 0) + 1);
      for (const [scope, count] of byScope) console.log(`  ${scope}: ${count}`);
    });
}
