import { QZoneClient } from './src/core/qzone-client.ts';

const qzone = new QZoneClient();
if (!qzone.loadCookie()) { console.log('未登录'); process.exit(1); }

const GUONAN = TARGET_QQ_1;
const s = qzone['session'];

// ── 拉取所有说说（修复分页：用实际返回数递增）──
const all = [];
let pos = 0;
let emptyCount = 0;
console.log('正在拉取全部说说...');
while (emptyCount < 3) {
  const batch = await qzone.getFeeds(GUONAN, pos, 20);
  if (!batch || batch.length === 0) {
    emptyCount++;
    pos += 20;
    continue;
  }
  emptyCount = 0;
  all.push(...batch);
  pos += batch.length; // 修复：按实际返回数递增
  process.stdout.write(`\r  已拉取 ${all.length} 条...`);
  await new Promise(r => setTimeout(r, 200));
}

console.log(`\n\n共 ${all.length} 条说说，逐条检查点赞...\n`);

// ── 查点赞 + 补赞 ──
let liked = 0, unliked = 0, fixed = 0, failed = 0;
for (const f of all) {
  const year = (f.createTime || '').slice(0, 4);
  const unikey = `http://user.qzone.qq.com/${GUONAN}/mood/${f.tid}`;
  const lcUrl = 'https://user.qzone.qq.com/proxy/domain/r.qzone.qq.com/cgi-bin/user/qz_opcnt2';
  const lcu = new URL(lcUrl);
  lcu.searchParams.set('g_tk', String(s.gtk2));
  lcu.searchParams.set('unikey', unikey);
  lcu.searchParams.set('fupdate', '1');

  const res = await fetch(lcu.toString(), {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://user.qzone.qq.com/' + s.uin,
      'Cookie': s.cookie,
    },
  });
  const text = await res.text();
  const data = JSON.parse(text.match(/\{[\s\S]*\}/)[0]);
  const ilike = data?.data?.[0]?.current?.likedata?.ilike;

  const content = (f.content || '').replace(/\n/g, ' ').slice(0, 55);

  if (ilike === 1) {
    liked++;
    console.log(`✅ [${f.createTime}] ${content}`);
  } else if (year === '2017') {
    unliked++;
    console.log(`🚫 [${f.createTime}] ${content} (2017老帖，无法点赞)`);
  } else {
    // 补赞
    try {
      await qzone.like(GUONAN, f.tid);
      fixed++;
      console.log(`🔧 [${f.createTime}] ${content} → 已补赞`);
    } catch (e) {
      failed++;
      console.log(`❌ [${f.createTime}] ${content} → 失败: ${e.message}`);
    }
  }

  await new Promise(r => setTimeout(r, 300));
}

console.log(`\n=== 结果 ===`);
console.log(`已赞: ${liked}  补赞: ${fixed}  失败: ${failed}  2017老帖: ${unliked}`);
