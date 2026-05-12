import { Command } from 'commander';
import chalk from 'chalk';
import { QZoneClient } from '../core/qzone-client.js';

function getClient(): QZoneClient {
  const client = new QZoneClient();
  if (!client.loadCookie()) {
    console.log(chalk.red('未登录 QZone，请先运行 qce qzone login'));
    process.exit(1);
  }
  return client;
}

export function qzoneCommand(program: Command): void {
  const qzone = program
    .command('qzone')
    .description('QQ 空间相关操作');

  // qce qzone login
  qzone
    .command('login')
    .description('扫码登录 QQ 空间')
    .action(async () => {
      const client = new QZoneClient();
      if (client.loadCookie()) {
        console.log(chalk.green(`已登录 (UIN: ${client.uin})`));
        console.log('如需重新登录，请先运行 qce qzone logout');
        return;
      }
      try {
        console.log('开始扫码登录...');
        await client.qrLogin();
        const info = await client.getUserInfo();
        console.log(chalk.green(`登录成功! ${info?.data?.nickname || info?.nickname || ''} (${client.uin})`));
      } catch (e: any) {
        console.error(chalk.red('登录失败:'), e.message);
      }
    });

  // qce qzone logout
  qzone
    .command('logout')
    .description('清除 QZone 登录状态')
    .action(() => {
      const client = new QZoneClient();
      client.clearCookie();
      console.log(chalk.green('已清除登录状态'));
    });

  // qce qzone me
  qzone
    .command('me')
    .description('查看自己的 QQ 空间信息')
    .action(async () => {
      const client = getClient();
      const info = await client.getUserInfo();
      const d = info?.data || info;
      console.log(chalk.bold('用户信息'));
      console.log(`  昵称:    ${d?.nickname || '(未设置)'}`);
      console.log(`  空间名:  ${d?.spacename || '(未设置)'}`);
      console.log(`  签名:    ${d?.signature || '(未设置)'}`);
      console.log(`  性别:    ${d?.sex === 1 ? '男' : d?.sex === 2 ? '女' : '未设置'}`);
      console.log(`  年龄:    ${d?.age || '未知'}`);
      console.log(`  生日:    ${d?.birthday || '未知'} (${d?.birthyear || ''})`);
      console.log(`  地区:    ${[d?.country, d?.province, d?.city].filter(Boolean).join(' ') || '未知'}`);
    });

  // qce qzone user <uin>
  qzone
    .command('user')
    .description('查看指定用户的 QQ 空间名片')
    .argument('<uin>', '目标 QQ 号')
    .action(async (uin: string) => {
      const client = getClient();
      const card = await client.getUserCard(parseInt(uin));
      const d = card?.data || card;
      console.log(chalk.bold(`用户名片 (${uin})`));
      console.log(`  昵称:    ${d?.nickname || '(未知)'}`);
      console.log(`  备注:    ${d?.remark || d?.remarkname || '(无)'}`);
      console.log(`  亲密度:  ${d?.intimacy || '0'}`);
      console.log(`  共同好友: ${d?.commonfriends || '0'}`);
      console.log(`  性别:    ${d?.sex === 1 ? '男' : d?.sex === 2 ? '女' : '未知'}`);
    });

  // qce qzone feeds [uin]
  qzone
    .command('feeds')
    .description('查看说说列表')
    .argument('[uin]', '目标 QQ 号 (默认自己)')
    .option('-n, --num <num>', '获取数量', '10')
    .option('-p, --pos <pos>', '起始位置', '0')
    .action(async (uin: string | undefined, options: { num: string; pos: string }) => {
      const client = getClient();
      const target = parseInt(uin || String(client.uin));
      const feeds = await client.getFeeds(target, parseInt(options.pos), parseInt(options.num));
      console.log(chalk.bold(`说说列表 (${target === client.uin ? '自己' : target}), 共 ${feeds?.length || 0} 条`));
      for (const f of feeds || []) {
        const time = f.createTime || f.created_time || '';
        const content = (f.content || '').replace(/\n/g, ' ').slice(0, 80);
        console.log(`  ${chalk.gray(`[${time}]`)} ${content}`);
        if (f.tid) console.log(chalk.dim(`    tid: ${f.tid}  👍${f.cmtnum || 0}  🔄${f.fwdnum || 0}`));
      }
    });

  // qce qzone post <text>
  qzone
    .command('post')
    .description('发说说')
    .argument('<text>', '说说内容')
    .action(async (text: string) => {
      const client = getClient();
      try {
        const result = await client.publish(text);
        if (result?.code === 0) {
          console.log(chalk.green('发送成功!'));
        } else {
          console.log(chalk.red('发送失败:'), result?.message || '未知错误');
        }
      } catch (e: any) {
        console.error(chalk.red('发送失败:'), e.message);
      }
    });

  // qce qzone delete <tid>
  qzone
    .command('delete')
    .description('删除说说')
    .argument('<tid>', '说说 TID')
    .action(async (tid: string) => {
      const client = getClient();
      try {
        const result = await client.deleteFeed(tid);
        if (result?.code === 0) {
          console.log(chalk.green('删除成功!'));
        } else {
          console.log(chalk.red('删除失败:'), result?.message || '未知错误');
        }
      } catch (e: any) {
        console.error(chalk.red('删除失败:'), e.message);
      }
    });

  // qce qzone friends
  qzone
    .command('friends')
    .description('查看好友列表')
    .action(async () => {
      const client = getClient();
      const friends = await client.getFriends();
      console.log(chalk.bold(`好友列表 (共 ${friends?.length || 0} 人)`));
      for (const f of friends || []) {
        console.log(`  ${f.nick || f.name} ${chalk.gray(`(${f.uin})`)}`);
      }
    });

  // qce qzone visitors
  qzone
    .command('visitors')
    .description('查看空间访客')
    .action(async () => {
      const client = getClient();
      const visitors = await client.getVisitors();
      console.log(chalk.bold(`空间访客 (共 ${visitors?.length || 0} 人)`));
      for (const v of visitors || []) {
        const time = v.time ? new Date((typeof v.time === 'string' ? parseInt(v.time) : v.time) * 1000).toLocaleString() : '';
        console.log(`  ${v.name || v.nickname || v.nick} ${chalk.gray(`(${v.uin})`)} ${chalk.dim(time)}`);
      }
    });

  // qce qzone board [uin]
  qzone
    .command('board')
    .description('查看留言板')
    .argument('[uin]', '目标 QQ 号 (默认自己)')
    .option('-n, --num <num>', '获取数量', '10')
    .action(async (uin: string | undefined, options: { num: string }) => {
      const client = getClient();
      const target = parseInt(uin || String(client.uin));
      const msgs = await client.getBoardMessages(target, 0, parseInt(options.num));
      console.log(chalk.bold(`留言板 (${target === client.uin ? '自己' : target}), 共 ${msgs?.length || 0} 条`));
      for (const m of msgs || []) {
        const content = (m.ubbContent || m.htmlContent || m.content || '').replace(/\n/g, ' ').slice(0, 80);
        const time = m.pubtime ? new Date(m.pubtime * 1000).toLocaleString() : '';
        console.log(`  ${chalk.cyan(m.nickname || '')} ${chalk.dim(time)}`);
        console.log(`    ${content}`);
      }
    });

  // qce qzone like <tid>
  qzone
    .command('like')
    .description('查看说说点赞数')
    .argument('<tid>', '说说 TID')
    .action(async (tid: string) => {
      const client = getClient();
      const unikey = `http://user.qzone.qq.com/${client.uin}/mood/${tid}`;
      const result = await client.getLikeCount(unikey);
      console.log(chalk.bold(`说说 ${tid} 点赞数`));
      console.log(JSON.stringify(result, null, 2));
    });

  // qce qzone albums [uin]
  qzone
    .command('albums')
    .description('查看相册列表')
    .argument('[uin]', '目标 QQ 号 (默认自己)')
    .action(async (uin: string | undefined) => {
      const client = getClient();
      const target = parseInt(uin || String(client.uin));
      const albums = await client.getAlbums(target);
      console.log(chalk.bold(`相册列表 (共 ${albums?.length || 0} 个)`));
      for (const a of albums || []) {
        console.log(`  ${a.name || a.albumname} ${chalk.gray(`(${a.id || a.albumid})`)} ${chalk.dim(`${a.picnum || a.photo_num || 0} 张`)}`);
      }
    });
}
