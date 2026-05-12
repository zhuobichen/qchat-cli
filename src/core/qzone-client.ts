/**
 * QZone HTTP API 客户端
 * 基于 qzone-go (github.com/guohuiyuan/qzone-go) 的 Node.js 移植版
 *
 * 认证：独立 QZone 网页扫码登录（与 NapCat 内部会话无关）
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

// ── Constants ──
const BASE_URL = 'https://user.qzone.qq.com';
const H5_BASE = 'https://h5.qzone.qq.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';
const COOKIE_FILE = join(import.meta.dirname, '..', '..', '.qzone-cookie');

// ── URLS (from qzone-go urls.go) ──
const URLS = {
  // 用户
  userInfo:      BASE_URL + '/proxy/domain/base.qzone.qq.com/cgi-bin/user/cgi_userinfo_get_all',
  userCard:      H5_BASE + '/proxy/domain/r.qzone.qq.com/cgi-bin/user/cgi_personal_card',
  userOverview:  BASE_URL + '/proxy/domain/r.qzone.qq.com/cgi-bin/main_page_cgi',

  // 说说 (emotion_cgi_msglist_v6 on taotao.qq.com)
  feedsList:     BASE_URL + '/proxy/domain/taotao.qq.com/cgi-bin/emotion_cgi_msglist_v6',
  feedsDetail:   H5_BASE + '/proxy/domain/taotao.qq.com/cgi-bin/emotion_cgi_msgdetail_v6',
  feedsPublish:  BASE_URL + '/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_publish_v6',
  feedsDelete:   H5_BASE + '/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_delete_v6',
  recentFeeds:   BASE_URL + '/proxy/domain/ic2.qzone.qq.com/cgi-bin/feeds/feeds3_html_more',

  // 评论/回复
  msgComments:   BASE_URL + '/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_getcmtreply_v6',
  commentAdd:    BASE_URL + '/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_re_feeds',
  replyAdd:      H5_BASE + '/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_re_feeds',

  // 点赞
  likeAdd:       BASE_URL + '/proxy/domain/w.qzone.qq.com/cgi-bin/likes/internal_dolike_app',

  // 好友
  friends:       BASE_URL + '/proxy/domain/r.qzone.qq.com/cgi-bin/tfriend/friend_show_qqfriends.cgi',
  friendship:    BASE_URL + '/proxy/domain/r.qzone.qq.com/cgi-bin/friendship/cgi_friendship',
  specialCare:   BASE_URL + '/proxy/domain/r.qzone.qq.com/cgi-bin/tfriend/specialcare_get.cgi',

  // 日志
  blogsList:     BASE_URL + '/proxy/domain/b.qzone.qq.com/cgi-bin/blognew/get_abs',
  blogsDetail:   BASE_URL + '/proxy/domain/b.qzone.qq.com/cgi-bin/blognew/blog_output_data',

  // 相册
  albums:        BASE_URL + '/proxy/domain/photo.qzone.qq.com/fcgi-bin/fcg_list_album_v3',
  photos:        BASE_URL + '/proxy/domain/photo.qzone.qq.com/fcgi-bin/cgi_list_photo',

  // 留言板
  board:         BASE_URL + '/proxy/domain/m.qzone.qq.com/cgi-bin/new/get_msgb',

  // 访客
  visitors:      BASE_URL + '/proxy/domain/g.qzone.qq.com/cgi-bin/friendshow/cgi_get_visitor_simple',
  itemVisitors:  BASE_URL + '/proxy/domain/g.qzone.qq.com/cgi-bin/friendshow/cgi_get_visitor_single',

  // 点赞
  likeCount:     BASE_URL + '/proxy/domain/r.qzone.qq.com/cgi-bin/user/qz_opcnt2',
  likeList:      BASE_URL + '/proxy/domain/users.qzone.qq.com/cgi-bin/likes/get_like_list_app',

  // 视频
  videos:        BASE_URL + '/proxy/domain/taotao.qq.com/cgi-bin/video_get_data',

  // 收藏
  favorites:     BASE_URL + '/proxy/domain/fav.qzone.qq.com/cgi-bin/get_fav_list',

  // 分享
  shares:        BASE_URL + '/p/h5/pc/api/sns.qzone.qq.com/cgi-bin/qzshare/cgi_qzsharegetmylistbytype',

  // 私密日记
  diaries:       BASE_URL + '/proxy/domain/b.qzone.qq.com/cgi-bin/privateblog/privateblog_get_titlelist',
};

// ── Login URLs ──
const QR_SHOW = 'https://ssl.ptlogin2.qq.com/ptqrshow?appid=549000912&e=2&l=M&s=3&d=72&v=4&t=0.31232733520361844&daid=5&pt_3rd_aid=0';
const QR_LOGIN = 'https://xui.ptlogin2.qq.com/ssl/ptqrlogin?u1=https://qzs.qq.com/qzone/v5/loginsucc.html?para=izone&ptqrtoken=%s&ptredirect=0&h=1&t=1&g=1&from_ui=1&ptlang=2052&action=0-0-1656992258324&js_ver=22070111&js_type=1&login_sig=&pt_uistyle=40&aid=549000912&daid=5&has_onekey=1&&o1vId=1e61428d61cb5015701ad73d5fb59f73';
const CHECK_SIG = 'https://ptlogin2.qzone.qq.com/check_sig?pttype=1&uin=%s&service=ptqrlogin&nodirect=1&ptsigx=%s&s_url=https://qzs.qq.com/qzone/v5/loginsucc.html?para=izone&f_url=&ptlang=2052&ptredirect=100&aid=549000912&daid=5&j_later=0&low_login_hour=0&regmaster=0&pt_login_type=3&pt_aid=0&pt_aaid=16&pt_light=0&pt_3rd_aid=0';

// ── Types ──
export interface QZoneSession {
  uin: number;
  skey: string;
  p_skey: string;
  cookie: string;
  gtk2: number;
}

// ── Helpers ──
function computeGTK(key: string, hash: number = 5381): number {
  for (let i = 0; i < key.length; i++) {
    hash += (hash << 5) + key.charCodeAt(i);
  }
  return hash & 0x7FFFFFFF;
}

/**
 * 解析 QQ 空间的 JSONP / JSON / 非标准 JSON 响应
 * 移植自 qzone-go parser.go
 */
function parseJSONP(text: string): any {
  let jsonStr: string;

  // 匹配 callback({...}) 格式 (qzone-go: jsonpRe)
  const jsonpMatch = text.match(/callback\s*\(\s*([^{]*(\{[\s\S]*\})[^)]*)\s*\)/i);
  if (jsonpMatch && jsonpMatch.length >= 3) {
    jsonStr = jsonpMatch[2];
  } else {
    // 提取最外层 {}
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      jsonStr = text.slice(start, end + 1);
    } else {
      return null;
    }
  }

  // QQ 空间有时会返回 undefined
  jsonStr = jsonStr.replace(/\bundefined\b/g, 'null').trim();

  // 尝试标准 JSON 解析
  try { return JSON.parse(jsonStr); } catch {}

  // 修复 JS 风格的未引用键: {code:0} -> {"code":0}
  const fixed = jsonStr.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');
  try { return JSON.parse(fixed); } catch {}

  return null;
}

function parseCookie(cookieStr: string): { uin: number; skey: string; p_skey: string } {
  let uin = 0, skey = '', p_skey = '';
  for (const part of cookieStr.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    const val = part.slice(eq + 1);
    if (name === 'uin') uin = parseInt(val.replace('o', '')) || 0;
    if (name === 'skey') skey = val;
    if (name === 'p_skey') p_skey = val;
  }
  return { uin, skey, p_skey };
}

// ── QR Code Login ──
export interface QRResult {
  image: Buffer;
  qrsig: string;
  ptqrtoken: string;
}

/** 获取 QZone 登录二维码 */
export async function getQRCode(): Promise<QRResult> {
  const res = await fetch(QR_SHOW, { redirect: 'manual' });
  const setCookie = res.headers.get('set-cookie') || '';
  const qrsig = setCookie.match(/qrsig=([^;]+)/)?.[1] || '';
  if (!qrsig) throw new Error('qrsig not found');

  const buf = Buffer.from(await res.arrayBuffer());
  const ptqrtoken = String(computeGTK(qrsig, 0));
  return { image: buf, qrsig, ptqrtoken };
}

export enum LoginState {
  Waiting = 'waiting',
  Scanned = 'scanned',
  Success = 'success',
  Expired = 'expired',
  Error = 'error',
}

/** 轮询登录状态 */
export async function pollQRLogin(qr: QRResult): Promise<{ state: LoginState; cookie?: string }> {
  const url = QR_LOGIN.replace('%s', qr.ptqrtoken);
  const res = await fetch(url, {
    headers: { Cookie: `qrsig=${qr.qrsig}` },
    redirect: 'manual',
  });

  // Collect cookies from response
  let ptCookie = '';
  const setCookies = (typeof res.headers.getSetCookie === 'function')
    ? res.headers.getSetCookie()
    : (res.headers.get('set-cookie') || '').split('\n');
  for (const c of setCookies) {
    const kv = c.split(';')[0]?.split('=');
    if (kv && kv.length >= 2 && kv[1]) {
      ptCookie += `${kv[0]}=${kv[1]}; `;
    }
  }

  const text = await res.text();

  if (text.includes('二维码已失效') || text.includes('expired')) {
    return { state: LoginState.Expired };
  }
  if (text.includes('二维码认证中') || text.includes('已扫描') || text.includes('认证成功')) {
    return { state: LoginState.Scanned };
  }
  if (text.includes('登录成功')) {
    const cleaned = text.replace(/'/g, '');
    const parts = cleaned.split(',');
    if (parts.length < 3) return { state: LoginState.Error };

    const redirectUrl = parts[2].trim();
    const u = new URL(redirectUrl);
    const uin = u.searchParams.get('uin') || '';
    const ptsigx = u.searchParams.get('ptsigx') || '';
    if (!uin || !ptsigx) return { state: LoginState.Error };

    // Check sig
    const sigRes = await fetch(CHECK_SIG.replace('%s', uin).replace('%s', ptsigx), { redirect: 'manual' });
    let redirectCookie = '';
    const sigCookies = (typeof sigRes.headers.getSetCookie === 'function')
      ? sigRes.headers.getSetCookie()
      : (sigRes.headers.get('set-cookie') || '').split('\n');
    for (const c of sigCookies) {
      const kv = c.split(';')[0]?.split('=');
      if (kv && kv.length >= 2 && kv[1]) {
        redirectCookie += `${kv[0]}=${kv[1]}; `;
      }
    }

    const fullCookie = ptCookie + redirectCookie;
    return { state: LoginState.Success, cookie: fullCookie };
  }

  return { state: LoginState.Waiting };
}

// ── QZone Client ──
export class QZoneClient {
  private session: QZoneSession | null = null;

  /** 是否已登录 */
  get loggedIn(): boolean {
    return this.session !== null && this.session.p_skey !== '';
  }

  get uin(): number {
    return this.session?.uin || 0;
  }

  /** 从 cookie 字符串初始化 */
  initFromCookie(cookieStr: string): void {
    // 移除空格 (matching qzone-go: strings.ReplaceAll(cookie, " ", ""))
    const cleaned = cookieStr.replace(/\s+/g, '');
    const { uin, skey, p_skey } = parseCookie(cleaned);
    if (!uin || !p_skey) throw new Error('Invalid cookie: missing uin or p_skey');
    this.session = {
      uin,
      skey,
      p_skey,
      cookie: cleaned,
      gtk2: computeGTK(p_skey),
    };
  }

  /** 从保存的文件加载 cookie */
  loadCookie(): boolean {
    try {
      if (existsSync(COOKIE_FILE)) {
        const cookie = readFileSync(COOKIE_FILE, 'utf-8').trim();
        this.initFromCookie(cookie);
        return true;
      }
    } catch {}
    return false;
  }

  /** 保存 cookie 到文件 */
  saveCookie(): void {
    if (this.session) {
      mkdirSync(join(import.meta.dirname, '..', '..'), { recursive: true });
      writeFileSync(COOKIE_FILE, this.session.cookie, 'utf-8');
    }
  }

  /** 清除登录状态 */
  clearCookie(): void {
    this.session = null;
    try { if (existsSync(COOKIE_FILE)) { writeFileSync(COOKIE_FILE, ''); } } catch {}
  }

  /** 执行完整扫码登录流程 */
  async qrLogin(): Promise<QZoneSession> {
    const qr = await getQRCode();
    const qrPath = join(import.meta.dirname, '..', '..', 'qzone-qrcode.png');
    writeFileSync(qrPath, qr.image);
    console.log(`\n二维码已保存: ${qrPath}`);
    console.log('请用手机 QQ 扫码...');

    return new Promise((resolve, reject) => {
      let attempts = 0;
      const timer = setInterval(async () => {
        attempts++;
        if (attempts > 120) { clearInterval(timer); reject(new Error('登录超时')); return; }
        try {
          const result = await pollQRLogin(qr);
          if (result.state === LoginState.Success && result.cookie) {
            clearInterval(timer);
            this.initFromCookie(result.cookie);
            this.saveCookie();
            console.log('登录成功!');
            resolve(this.session!);
          } else if (result.state === LoginState.Expired) {
            clearInterval(timer);
            reject(new Error('二维码已过期'));
          } else if (result.state === LoginState.Scanned) {
            if (attempts % 5 === 1) console.log('  已扫码，请确认...');
          }
        } catch (e) {
          if (attempts > 120) { clearInterval(timer); reject(e); }
        }
      }, 2000);
    });
  }

  // ── HTTP Request ──
  private async request(url: string, params: Record<string, string> = {}, postData?: Record<string, string>): Promise<any> {
    if (!this.session) throw new Error('Not logged in');

    const gtk = String(this.session.gtk2);
    const u = new URL(url);
    // Add g_tk if not already in params
    if (!params.g_tk) u.searchParams.set('g_tk', gtk);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '') u.searchParams.set(k, v);
    }

    const headers: Record<string, string> = {
      'User-Agent': UA,
      'Referer': `${BASE_URL}/${this.session.uin}`,
      'Origin': BASE_URL,
      'Cookie': this.session.cookie,
    };

    const opts: RequestInit = { method: 'GET', headers, redirect: 'manual' };
    if (postData) {
      opts.method = 'POST';
      opts.body = new URLSearchParams(postData).toString();
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }

    const res = await fetch(u.toString(), opts);
    const text = await res.text();
    const parsed = parseJSONP(text);

    if (!parsed || parsed.code === -3000) {
      throw new Error('Session expired');
    }
    return parsed;
  }

  // ══════════════════════════════════════
  // 说说 (ported from api_feed.go / api_emotion.go)
  // ══════════════════════════════════════
  async getFeeds(uin: number, pos = 0, num = 20) {
    const r = await this.request(URLS.feedsList, {
      g_tk: String(this.session!.gtk2),
      uin: String(uin),
      ftype: '0',
      sort: '0',
      pos: String(pos),
      num: String(num),
      replynum: '99',
      callback: '_preloadCallback',
      code_version: '1',
      format: 'json',
      need_comment: '1',
      need_private_comment: '1',
    });
    return r?.msglist || [];
  }
  async getMyFeeds(pos = 0, num = 20) { return this.getFeeds(this.session!.uin, pos, num); }
  async getDetail(uin: number, tid: string) {
    return this.request(URLS.feedsDetail, {
      uin: String(uin), tid, format: 'json',
      g_tk: String(this.session!.gtk2),
    });
  }
  async getRecentFeeds(page = 1) {
    return this.request(URLS.recentFeeds, {
      uin: String(this.session!.uin),
      scope: '0', view: '1', filter: 'all', flag: '1', applist: 'all',
      pagenum: String(page),
      aisortEndTime: '0', aisortOffset: '0', aisortBeginTime: '0',
      begintime: '0', format: 'json',
      g_tk: String(this.session!.gtk2),
      useutf8: '1', outputhtmlfeed: '1',
    });
  }
  async publish(text: string) {
    return this.request(URLS.feedsPublish, {
      g_tk: String(this.session!.gtk2),
    }, { syn_tweet_verson: '1', paramstr: '1', content: text });
  }
  async deleteFeed(tid: string) {
    return this.request(URLS.feedsDelete, {
      g_tk: String(this.session!.gtk2),
    }, { tid });
  }

  // ══════════════════════════════════════
  // 工具方法
  // ══════════════════════════════════════
  // 构造说说 unikey（必须用 http://，不能用 https://，QZone 服务器把它们当不同 key）
  makeUnikey(uin: number, tid: string): string {
    return `http://user.qzone.qq.com/${uin}/mood/${tid}`;
  }

  // ══════════════════════════════════════
  // 互动 (ported from api_comment.go / api_like.go)
  // ══════════════════════════════════════
  async like(targetUin: number, tid: string) {
    const moodUrl = this.makeUnikey(targetUin, tid);
    return this.request(URLS.likeAdd, {
      g_tk: String(this.session!.gtk2),
    }, {
      qzreferrer: `${BASE_URL}/${this.session!.uin}`,
      opuin: String(this.session!.uin),       // 操作者是自己
      unikey: moodUrl,
      curkey: moodUrl,
      appid: '311',
      from: '1',
      typeid: '0',
      abstime: String(Math.floor(Date.now() / 1000)),
      fid: tid,
      active: '0',
      format: 'json',
      fupdate: '1',
    });
  }
  async postComment(targetUin: number, tid: string, content: string) {
    return this.request(URLS.commentAdd, {
      g_tk: String(this.session!.gtk2),
    }, {
      topicId: `${targetUin}_${tid}__1`,
      uin: String(this.session!.uin),
      hostUin: String(targetUin),
      feedsType: '100',
      inCharset: 'utf-8',
      outCharset: 'utf-8',
      plat: 'qzone',
      source: 'ic',
      platformid: '52',
      format: 'fs',
      ref: 'feeds',
      content,
    });
  }
  async replyToComment(targetUin: number, tid: string, commentId: string, commentUin: string, content: string) {
    return this.request(URLS.replyAdd, {
      g_tk: String(this.session!.gtk2),
    }, {
      topicId: `${targetUin}_${tid}__1`,
      uin: String(this.session!.uin),
      hostUin: String(targetUin),
      feedsType: '100',
      inCharset: 'utf-8',
      outCharset: 'utf-8',
      plat: 'qzone',
      source: 'ic',
      platformid: '52',
      format: 'fs',
      ref: 'feeds',
      content,
      commentId,
      commentUin,
      richval: '',
      richtype: '',
      private: '0',
      paramstr: '2',
      qzreferrer: `https://user.qzone.qq.com/${this.session!.uin}/main`,
    });
  }

  // ══════════════════════════════════════
  // 用户 (ported from api_user.go)
  // ══════════════════════════════════════
  async getUserInfo(uin?: number) {
    return this.request(URLS.userInfo, {
      uin: String(uin || this.session!.uin),
      vuin: String(this.session!.uin),
      fupdate: '1',
      rd: String(Math.random()),
    });
  }
  async getUserCard(uin: number) {
    return this.request(URLS.userCard, {
      uin: String(uin), fupdate: '1', rd: String(Math.random()),
    });
  }

  // ══════════════════════════════════════
  // 好友 (ported from api_friend.go)
  // ══════════════════════════════════════
  async getFriends() {
    const r = await this.request(URLS.friends, {
      uin: String(this.session!.uin), format: 'json',
      g_tk: String(this.session!.gtk2),
    });
    return r?.items || [];
  }
  async getFriendship(uin: number) {
    return this.request(URLS.friendship, {
      uin: String(uin), format: 'json',
      g_tk: String(this.session!.gtk2),
    });
  }
  async getSpecialCare() {
    const r = await this.request(URLS.specialCare, {
      format: 'json', g_tk: String(this.session!.gtk2),
    });
    return r?.items || [];
  }

  // ══════════════════════════════════════
  // 访客 (ported from api_visitor.go)
  // ══════════════════════════════════════
  async getVisitors() {
    const r = await this.request(URLS.visitors, {
      uin: String(this.session!.uin), mask: '0', mod: '2', act: '1',
      fupdate: '1', format: 'json',
      g_tk: String(this.session!.gtk2),
    });
    return r?.data?.items || [];
  }

  // ══════════════════════════════════════
  // 评论列表 (ported from api_comment.go)
  // ══════════════════════════════════════
  async getMessageComments(targetUin: number, tid: string, pos = 0, num = 20) {
    const r = await this.request(URLS.msgComments, {
      uin: String(this.session!.uin),
      hostUin: String(targetUin),
      topicId: `${targetUin}_${tid}`,
      start: String(pos),
      num: String(num),
      order: '0',
      format: 'jsonp',
      inCharset: 'utf-8',
      outCharset: 'utf-8',
      ref: 'qzone',
      random: String(Math.random()),
      need_private_comment: '1',
      g_tk: String(this.session!.gtk2),
    });
    return r?.data?.comments || r?.comments || r?.commentlist || [];
  }
  async getAllMessageComments(uin: number, tid: string) {
    const all: any[] = [];
    let pos = 0;
    while (true) {
      const comments = await this.getMessageComments(uin, tid, pos, 50);
      if (!comments || comments.length === 0) break;
      all.push(...comments);
      if (comments.length < 50) break;
      pos += 50;
    }
    return all;
  }

  // ══════════════════════════════════════
  // 相册 (ported from api_album.go)
  // ══════════════════════════════════════
  async getAlbums(uin: number, pos = 0, num = 20) {
    const r = await this.request(URLS.albums, {
      uin: String(uin), pos: String(pos), num: String(num),
      format: 'json', outstyle: 'json',
      g_tk: String(this.session!.gtk2),
    });
    return r?.album || r?.albums || [];
  }
  async getPhotos(uin: number, albumId: string, pos = 0, num = 20) {
    const r = await this.request(URLS.photos, {
      uin: String(uin), topicId: albumId, pos: String(pos), num: String(num),
      outstyle: 'json', format: 'json',
      g_tk: String(this.session!.gtk2),
    });
    return r?.photos || r?.piclist || [];
  }

  // ══════════════════════════════════════
  // 留言板 / 日志 / 点赞
  // ══════════════════════════════════════
  async getBoardMessages(targetUin: number, pos = 0, num = 20) {
    const r = await this.request(URLS.board, {
      uin: String(this.session!.uin),
      hostUin: String(targetUin),
      start: String(pos), num: String(num),
      format: 'jsonp', inCharset: 'utf-8', outCharset: 'utf-8',
      s: String(Math.random()),
      g_tk: String(this.session!.gtk2),
    });
    return r?.data?.commentList || [];
  }
  async getBlogs(uin: number, pos = 0, num = 20) {
    const r = await this.request(URLS.blogsList, {
      uin: String(uin), pos: String(pos), num: String(num),
      format: 'json', g_tk: String(this.session!.gtk2),
    });
    return r?.bloglist || [];
  }
  async getLikeCount(unikey: string) {
    return this.request(URLS.likeCount, {
      unikey, fupdate: '1',
      g_tk: String(this.session!.gtk2),
    });
  }
  async getLikeList(unikey: string, beginUin = 0) {
    const r = await this.request(URLS.likeList, {
      uin: String(this.session!.uin),
      unikey,
      begin_uin: String(beginUin),
      query_count: '60',
      if_first_page: beginUin === 0 ? '1' : '0',
      g_tk: String(this.session!.gtk2),
    });
    return r?.data?.like_uin_info || [];
  }

  // ══════════════════════════════════════
  // 视频 / 收藏 / 分享 / 日记
  // ══════════════════════════════════════
  async getVideos(uin: number, pos = 0, num = 20) {
    const r = await this.request(URLS.videos, {
      uin: String(uin), pos: String(pos), num: String(num),
      format: 'json', g_tk: String(this.session!.gtk2),
    });
    return r?.vlist || [];
  }
  async getFavorites(pos = 0, num = 20) {
    const r = await this.request(URLS.favorites, {
      uin: String(this.session!.uin), pos: String(pos), num: String(num),
      format: 'json', g_tk: String(this.session!.gtk2),
    });
    return r?.list || [];
  }
  async getDiaries(pos = 0, num = 20) {
    const r = await this.request(URLS.diaries, {
      uin: String(this.session!.uin), pos: String(pos), num: String(num),
      format: 'json', g_tk: String(this.session!.gtk2),
    });
    return r?.bloglist || [];
  }
}
