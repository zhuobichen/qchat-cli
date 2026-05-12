/**
 * QZone 扫码登录脚本
 * 用法: npx tsx qzone-login.mjs
 */
import { QZoneClient } from './src/core/qzone-client.ts';

const qzone = new QZoneClient();

if (qzone.loadCookie()) {
  console.log('已有登录缓存, UIN:', qzone.uin);
  try {
    const info = await qzone.getUserInfo();
    console.log('会话有效, 昵称:', info?.data?.nickname || info?.nickname);
    process.exit(0);
  } catch {
    console.log('会话已过期，重新登录...');
    qzone.clearCookie();
  }
}

await qzone.qrLogin();
const info = await qzone.getUserInfo();
console.log('\n登录成功!');
console.log('昵称:', info?.data?.nickname || info?.nickname);
console.log('UIN:', qzone.uin);
