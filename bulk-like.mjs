import { QZoneClient } from './src/core/qzone-client.ts';

const qzone = new QZoneClient();
if (!qzone.loadCookie()) { console.log('未登录'); process.exit(1); }

const GUONAN = TARGET_QQ_1;
const s = qzone['session'];

// 拉取全部说说
const all = [];
let pos = 0, emptyCount = 0;
while (emptyCount < 3) {
  const batch = await qzone.getFeeds(GUONAN, pos, 20);
  if (!batch || batch.length === 0) { emptyCount++; pos += 20; continue; }
  emptyCount = 0;
  all.push(...batch);
  pos += batch.length;
}

console.log(`共 ${all.length} 条说说，检查中...\n`);

// 找出未赞的
const unliked = [];
for (const f of all) {
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

  if (ilike !== 1) {
    unliked.push(f);
    console.log(`❌ [${f.createTime}] ${(f.content || '').slice(0, 40)}`);
  }
}

console.log(`\n未赞 ${unliked.length} 条，开始补赞...\n`);

let ok = 0, fail = 0;
for (const f of unliked) {
  try {
    await qzone.like(GUONAN, f.tid);
    ok++;
    console.log(`  ✅ [${f.createTime}]`);
    // 稍微延迟防限流
    await new Promise(r => setTimeout(r, 300));
  } catch (e) {
    fail++;
    console.log(`  ⚠️ [${f.createTime}] 失败: ${e.message}`);
  }
}

console.log(`\n完成! 成功: ${ok}, 失败: ${fail}`);
