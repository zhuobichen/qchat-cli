/**
 * private/ 快捷入口 — 自动读取 private/config.json
 * 等同于: npx tsx monitor-live.mjs（根目录的也会自动读 config.json）
 *
 * 用法: npx tsx private/monitor-live.mjs
 */
import { loadConfig } from './load-config.mjs';

const cfg = loadConfig();
const args = [
  '--myqq', String(cfg.myQQ),
  '--friends', (cfg.monitoredFriends || []).join(','),
];
if (cfg.replyWhitelist?.length) args.push('--whitelist', cfg.replyWhitelist.join(','));
if (cfg.deepseekApiKey) args.push('--api-key', cfg.deepseekApiKey);

process.argv = [process.argv[0], process.argv[1], ...args];
await import('../monitor-live.mjs');
