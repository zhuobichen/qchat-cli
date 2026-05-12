import { QZoneClient } from './src/core/qzone-client.ts';

const qzone = new QZoneClient();
if (!qzone.loadCookie()) { console.log('未登录'); process.exit(1); }

const GUONAN = TARGET_QQ_1;
const s = qzone['session'];

let pos = 0;
let likedCount = 0, unlikedCount = 0;

let emptyCount = 0;
while (emptyCount < 3) {
  const feeds = await qzone.getFeeds(GUONAN, pos, 20);
  if (!feeds || feeds.length === 0) { emptyCount++; pos += 20; continue; }
  emptyCount = 0;

  for (const f of feeds) {
    const unikey = `http://user.qzone.qq.com/${GUONAN}/mood/${f.tid}`;

    const lcUrl = 'https://user.qzone.qq.com/proxy/domain/r.qzone.qq.com/cgi-bin/user/qz_opcnt2';
    const lcu = new URL(lcUrl);
    lcu.searchParams.set('g_tk', String(s.gtk2));
    lcu.searchParams.set('unikey', unikey);
    lcu.searchParams.set('fupdate', '1');

    const lcRes = await fetch(lcu.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://user.qzone.qq.com/' + s.uin,
        'Cookie': s.cookie,
      },
    });
    const lcText = await lcRes.text();
    const lcData = JSON.parse(lcText.match(/\{[\s\S]*\}/)[0]);
    const ilike = lcData?.data?.[0]?.current?.likedata?.ilike;

    const status = ilike === 1 ? '✅' : '❌';
    const time = f.createTime || f.created_time || '';
    const content = (f.content || '').replace(/\n/g, ' ').slice(0, 55);

    if (ilike === 1) likedCount++; else unlikedCount++;
    console.log(`${status} [${time}] ${content}`);
  }

  pos += feeds.length;
  if (feeds.length < 20) break;
}

console.log(`\n已赞: ${likedCount}  未赞: ${unlikedCount}`);
