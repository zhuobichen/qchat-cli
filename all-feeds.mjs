import { QZoneClient } from './src/core/qzone-client.ts';

const qzone = new QZoneClient();
if (!qzone.loadCookie()) { console.log('未登录'); process.exit(1); }

const GUONAN = TARGET_QQ_1;

console.log('正在拉取全部说说...\n');

const all = [];
let pos = 0, emptyCount = 0;
while (emptyCount < 3) {
  const batch = await qzone.getFeeds(GUONAN, pos, 20);
  if (!batch || batch.length === 0) { emptyCount++; pos += 20; continue; }
  emptyCount = 0;
  all.push(...batch);
  pos += batch.length;
  process.stdout.write(`\r  已拉取 ${all.length} 条...`);
}

console.log(`\n\n=== 郭楠(TARGET_QQ_1)的全部说说，共 ${all.length} 条 ===\n`);

for (const f of all) {
  const time = f.createTime || f.created_time || '';
  const content = (f.content || '').trim();
  console.log(`[${time}]`);
  // 按句号换行，方便阅读
  const lines = content.replace(/\n/g, '\n    ');
  console.log(`  ${lines}`);
  console.log('');
}

console.log(`--- 共 ${all.length} 条 ---`);
