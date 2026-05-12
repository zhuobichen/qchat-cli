/**
 * QZone API 测试脚本
 * 用法: npx tsx test-qzone.mjs
 */
import { QZoneClient } from './src/core/qzone-client.ts';

const qzone = new QZoneClient();

async function main() {
  // 尝试从文件加载 cookie
  if (qzone.loadCookie()) {
    console.log('从缓存加载 cookie 成功, UIN:', qzone.uin);
  } else {
    console.log('未找到缓存 cookie，开始扫码登录...\n');
    await qzone.qrLogin();
  }

  console.log('');

  // 1. 获取用户信息
  console.log('=== 用户信息 ===');
  try {
    const info = await qzone.getUserInfo();
    console.log('昵称:', info?.data?.nickname || info?.nickname);
    console.log('空间名:', info?.data?.spacename || info?.spacename);
    console.log('ok');
  } catch (e) { console.error('失败:', e.message); }

  // 2. 获取好友列表
  console.log('\n=== 好友列表 (前5) ===');
  try {
    const friends = await qzone.getFriends();
    console.log('好友数:', friends.length);
    for (const f of friends.slice(0, 5)) {
      console.log(`  ${f.nick || f.name} (${f.uin})`);
    }
  } catch (e) { console.error('失败:', e.message); }

  // 3. 获取说说列表
  console.log('\n=== 自己的说说 (前3) ===');
  try {
    const feeds = await qzone.getMyFeeds(0, 3);
    console.log('说说数:', feeds?.length || 0);
    if (feeds) {
      for (const f of feeds.slice(0, 3)) {
        const text = (f.content || f.summary || '').slice(0, 60);
        console.log(`  [${f.created_time || f.createTime}] ${text}`);
      }
    }
  } catch (e) { console.error('失败:', e.message); }

  // 4. 获取访客
  console.log('\n=== 空间访客 (前5) ===');
  try {
    const visitors = await qzone.getVisitors();
    for (const v of (visitors || []).slice(0, 5)) {
      console.log(`  ${v.name || v.nickname || v.nick} (${v.uin}) - ${v.time || v.login_time || ''}`);
    }
  } catch (e) { console.error('失败:', e.message); }

  // 5. 获取留言板
  console.log('\n=== 留言板 (前3) ===');
  try {
    const msgs = await qzone.getBoardMessages(qzone.uin, 0, 3);
    console.log('留言数:', msgs?.length || 0);
    for (const m of (msgs || []).slice(0, 3)) {
      const text = (m.ubbContent || m.htmlContent || m.content || '').slice(0, 60);
      console.log(`  [${m.nickname || m.nick || m.name || ''}] ${text}`);
    }
  } catch (e) { console.error('失败:', e.message); }

  // 6. 获取点赞数 (用说说TID)
  console.log('\n=== 点赞测试 ===');
  try {
    const feeds = await qzone.getMyFeeds(0, 1);
    if (feeds && feeds.length > 0) {
      const tid = feeds[0].tid;
      const unikey = `http://user.qzone.qq.com/${qzone.uin}/mood/${tid}`;
      const count = await qzone.getLikeCount(unikey);
      console.log(`说说 ${tid} 点赞数:`, JSON.stringify(count).slice(0, 150));
    }
  } catch (e) { console.error('失败:', e.message); }

  // 7. 获取用户名片
  console.log('\n=== 用户名片 (测试其他用户) ===');
  try {
    const card = await qzone.getUserCard(TARGET_QQ_1);
    console.log('昵称:', card?.data?.nickname || card?.nickname);
    console.log('ok');
  } catch (e) { console.error('失败:', e.message); }

  console.log('\n测试完成!');
}

main().catch(e => { console.error(e); process.exit(1); });
