#!/usr/bin/env node
/**
 * qce-auto —— 常驻自动回复进程
 *
 * 循环：轮询新消息 → 判断该不该回 → 生成回复 → 决定文字/语音 → 发送
 *
 * 与 qq-watch 的分工：
 *   qq-watch  : 把消息推给 DSH 会话（人/Agent 在环里）
 *   qce-auto  : 自己判断、自己回（常驻，挂了自动重试，失败进死信）
 *
 * 用法:
 *   node scripts/qce-auto.mjs              # 常驻
 *   node scripts/qce-auto.mjs --once       # 跑一轮就退出（调试）
 *   node scripts/qce-auto.mjs --status     # 看状态
 *   node scripts/qce-auto.mjs --dlq        # 看死信
 *   node scripts/qce-auto.mjs --replay <id>
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, renameSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = join(ROOT, 'private', 'auto-reply.config.json');
const STATE_DIR = process.env.QCE_AUTO_STATE_DIR ?? join(ROOT, 'private', '.auto');
const STATE_PATH = join(STATE_DIR, 'state.json');
const LOG_PATH = join(ROOT, 'output', 'qce-auto.log');
const DLQ_PATH = join(STATE_DIR, 'dlq.jsonl');

const ONCE = process.argv.includes('--once');
const STATUS = process.argv.includes('--status');
const SHOW_DLQ = process.argv.includes('--dlq');
const REPLAY_ID = (() => {
  const i = process.argv.indexOf('--replay');
  return i >= 0 ? process.argv[i + 1] : '';
})();

function log(...parts) {
  const line = `[${new Date().toISOString()}] ${parts.join(' ')}`;
  console.log(line);
  try {
    mkdirSync(join(ROOT, 'output'), { recursive: true });
    appendFileSync(LOG_PATH, line + '\n', 'utf8');
  } catch {}
}

// ————— 配置 —————
function loadConfig() {
  let raw = {};
  try { raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')); } catch {}

  let token = raw.token;
  if (!token) {
    try {
      const p = join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'qchat-cli-nodejs', 'Config', 'config.json');
      token = JSON.parse(readFileSync(p, 'utf8')).token ?? '';
    } catch { token = ''; }
  }

  return {
    http: raw.http ?? 'http://127.0.0.1:3000',
    token,
    groups: Array.isArray(raw.groups) ? raw.groups.map(Number) : [],
    includePrivate: raw.includePrivate !== false,
    allow: Array.isArray(raw.allow) ? raw.allow.map(String) : [],
    intervalSec: Math.max(raw.intervalSec ?? 2, 1),
    maxAgeSec: Math.max(raw.maxAgeSec ?? 600, 30),
    minReplyGapSec: Math.max(raw.minReplyGapSec ?? 20, 0),
    requireMentionInGroup: raw.requireMentionInGroup !== false,
    freeChat: raw.freeChat === true,
    freeChatProbability: Math.min(Math.max(raw.freeChatProbability ?? 0.35, 0), 1),
    // 偷表情包：看到别人发的表情就存进库。每群每天上限默认 8 张
    stealStickers: raw.stealStickers !== false,
    stealDailyLimit: Math.max(raw.stealDailyLimit ?? 8, 0),
    maxRepliesPerHour: Math.max(raw.maxRepliesPerHour ?? 8, 1),
    emojiChance: Math.min(Math.max(raw.emojiChance ?? 0.3, 0), 1),
    allowVoice: raw.allowVoice !== false,
    ttsEndpoint: raw.ttsEndpoint ?? '',
    ttsRefAudio: raw.ttsRefAudio ?? '',
    ttsPromptText: raw.ttsPromptText ?? '',
    outputDir: raw.outputDir ?? join(ROOT, 'output'),
    stateDir: STATE_DIR,
  };
}

const cfg = loadConfig();

// ————— 状态（原子写，断点续传）—————
function emptyState() {
  return { version: 1, handled: {}, lastReplyAt: {}, replyTimes: {}, cursors: {}, stats: { polls: 0, replied: 0, skipped: 0, failed: 0 } };
}

function loadState() {
  if (!existsSync(STATE_PATH)) return emptyState();
  try {
    const p = JSON.parse(readFileSync(STATE_PATH, 'utf8'));
    return {
      ...emptyState(), ...p,
      handled: p.handled ?? {}, lastReplyAt: p.lastReplyAt ?? {}, replyTimes: p.replyTimes ?? {},
      cursors: p.cursors ?? {}, stats: p.stats ?? emptyState().stats,
    };
  } catch {
    try { writeFileSync(`${STATE_PATH}.corrupt-${Date.now()}`, readFileSync(STATE_PATH)); } catch {}
    return emptyState();
  }
}

function saveState(s) {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    const ids = Object.keys(s.handled);
    if (ids.length > 3000) for (const id of ids.slice(0, ids.length - 3000)) delete s.handled[id];
    const tmp = `${STATE_PATH}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify(s), 'utf8');
    renameSync(tmp, STATE_PATH);
  } catch {}
}

const state = loadState();

// ————— 可靠性 —————
let consecutiveFailures = 0;
let breakerOpenedAt = 0;
const BREAKER_THRESHOLD = 5;
const BREAKER_COOLDOWN = 60000;

function breakerOpen() {
  return breakerOpenedAt > 0 && Date.now() - breakerOpenedAt < BREAKER_COOLDOWN;
}
function breakerRecord(ok) {
  if (ok) { consecutiveFailures = 0; breakerOpenedAt = 0; return; }
  consecutiveFailures += 1;
  if (consecutiveFailures >= BREAKER_THRESHOLD) {
    breakerOpenedAt = Date.now();
    log(`熔断打开：连续失败 ${consecutiveFailures} 次`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pushDlq(kind, payload, error) {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    const entry = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      kind, payload, error: String(error?.message ?? error),
      attempts: 3, createdAt: Date.now(),
    };
    appendFileSync(DLQ_PATH, `${JSON.stringify(entry)}\n`, 'utf8');
    state.stats.failed += 1;
    log(`进死信: ${kind} (${entry.id}) — ${entry.error}`);
  } catch (e) { log(`写死信失败: ${e.message}`); }
}

function readDlq() {
  if (!existsSync(DLQ_PATH)) return [];
  return readFileSync(DLQ_PATH, 'utf8').split('\n').filter((l) => l.trim()).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

function writeDlq(list) {
  writeFileSync(DLQ_PATH, list.map((e) => JSON.stringify(e)).join('\n') + (list.length ? '\n' : ''), 'utf8');
}

// ————— OneBot —————
async function api(action, params = {}, timeoutMs = 20000) {
  const res = await fetch(`${cfg.http}/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {}) },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const json = await res.json();
  if (json.status !== 'ok' && json.retcode !== 0) throw new Error(`${action}: ${json.message ?? json.wording ?? 'failed'}`);
  return json.data;
}

function flatten(message) {
  if (typeof message === 'string') return message;
  if (!Array.isArray(message)) return '';
  return message.map((s) => {
    switch (s?.type) {
      case 'text': return s.data?.text ?? '';
      case 'image': return '[图片]';
      case 'face': case 'mface': return '[表情]';
      case 'record': return '[语音]';
      case 'video': return '[视频]';
      case 'file': return '[文件]';
      case 'at': return `@${s.data?.qq === 'all' ? '全体' : s.data?.qq}`;
      case 'reply': return '';
      default: return `[${s?.type ?? '?'}]`;
    }
  }).join('').trim();
}

function mentionsSelf(msg, selfUin) {
  if (!Array.isArray(msg.message)) return false;
  return msg.message.some((s) => s.type === 'at' && String(s.data?.qq) === String(selfUin));
}

function hasVoice(msg) {
  return Array.isArray(msg.message) && msg.message.some((s) => s.type === 'record');
}

/**
 * 是不是表情包（斗图用的），而不是截图/照片。
 *
 * 区分依据：
 *   1. `face` / `mface` 段 = QQ 内置表情 → 确定是表情
 *   2. `image` 段且 sub_type 是 1（表情）或 summary 带方括号（如 [呵呵]）→ 表情
 *   3. 文字部分为空或只有很少字 → 更像纯表情互动
 */
function hasSticker(msg) {
  if (!Array.isArray(msg.message)) return false;
  let hasImage = false;
  for (const s of msg.message) {
    if (s.type === 'face' || s.type === 'mface') return true;
    if (s.type === 'image') {
      hasImage = true;
      const d = s.data ?? {};
      if (String(d.sub_type) === '1') return true;
      if (/^\[.+\]$/.test(String(d.summary ?? ''))) return true;
    }
  }
  if (!hasImage) return false;
  // 有图但文字很多 → 是在说事，不是斗图
  const textLen = msg.message
    .filter((s) => s.type === 'text')
    .map((s) => String(s.data?.text ?? ''))
    .join('').trim().length;
  return textLen <= 3;
}

// ————— 回复生成（复用 qchat-cli 的 core）—————
let core = null;
async function loadCore() {
  if (core) return core;
  const dist = join(ROOT, 'dist', 'core');
  // Windows 上绝对路径必须转 file:// URL 才能被 ESM loader 接受
  const imp = (name) => import(pathToFileURL(join(dist, name)).href);
  core = {
    group: await imp('group-agent.js'),
    gate: await imp('reply-gate.js'),
    sticker: await imp('sticker.js'),
    medium: await imp('reply-medium.js'),
    reliability: await imp('reliability.js'),
    tts: await imp('tts.js'),
    persona: await imp('persona.js'),
    humanize: await imp('humanize.js'),
    owner: await imp('owner.js'),
    affinity: await imp('affinity.js'),
    segments: await imp('segments.js'),
    steal: await imp('sticker-steal.js'),
    profile: await imp('profile-store.js'),
    memory: await imp('memory.js'),
    context: await imp('group-context.js'),
    store: await imp('message-store.js'),
  };
  return core;
}

// ————— 主循环 —————
let selfUin = 0;
let offlinePolls = 0;

/**
 * 该不该回。
 *
 * 两层：
 *   1. 硬规则（确定性，永远先生效）：白名单 / 群列表 / 消息年龄 / 最小间隔 / 每小时上限
 *   2. 群里没 @ 我时：交给 Jev 判断（reply|wait|skip），置信度不够回落规则（默认不回）
 *
 * 为什么要 Jev 而不是"没 @ 就不回"：一句话是否值得接，靠 @ 判断不出来。
 *   「那个机器人是不是又挂了」没 @ 我在说我；「今天食堂真难吃」跟我无关。
 *   但也不能全交给概率——所以有置信度门槛 + 概率阻尼 + 每小时上限。
 */
async function shouldReply(kind, peer, mentioned, time, recent = []) {
  const key = `${kind === 'group' ? 'g' : 'p'}${peer}`;
  const now = Math.floor(Date.now() / 1000);

  // 被骂标记先算出来：后面所有 return 都要带它，
  // 否则「@ 我 + 骂我」会走上方的快速通道，还嘴指令就丢了。
  const lastText = String(recent[recent.length - 1]?.text ?? '');
  let abused = false;
  try {
    const c0 = await loadCore();
    abused = c0.gate.detectAbuse(lastText, {
      groupSize: kind === 'group' ? await groupSize(peer) : 0,
      mentioned,
    });
  } catch { abused = false; }

  // —— 硬规则：这些不管 Jev 说什么都不回 ——
  if (cfg.allow.length > 0 && !cfg.allow.includes(String(peer))) return { reply: false, reason: '不在白名单' };
  if (kind === 'group' && !cfg.groups.includes(Number(peer))) return { reply: false, reason: '该群不在自动回复列表' };
  if (kind === 'private' && !cfg.includePrivate) return { reply: false, reason: '私聊自动回复已关闭' };
  if (now - time > cfg.maxAgeSec) return { reply: false, reason: `消息太老（${now - time}s）` };

  const last = state.lastReplyAt[key] ?? 0;
  if (last && now - last < cfg.minReplyGapSec) {
    return { reply: false, reason: `距上次回复不足 ${cfg.minReplyGapSec}s` };
  }

  // 每小时上限：自由接话最容易翻车的地方，必须兜住
  const hourAgo = now - 3600;
  const recentReplies = (state.replyTimes?.[key] ?? []).filter((t) => t > hourAgo);
  if (recentReplies.length >= cfg.maxRepliesPerHour) {
    return { reply: false, reason: `一小时内已回 ${recentReplies.length} 次，到上限` };
  }

  // —— @ 我 / 私聊：直接通过 ——
  if (mentioned || kind === 'private') {
    return { reply: true, ...(abused ? { abuse: true } : {}), reason: mentioned ? '@ 到我' : '私聊' };
  }

  // —— 群里没 @：Jev 判断 ——
  if (cfg.requireMentionInGroup) return { reply: false, reason: '群里没 @ 我（已配置必须 @）' };
  if (!cfg.freeChat) return { reply: false, reason: '自由接话未开启' };

  try {
    const c = await loadCore();
    const size = kind === 'group' ? await groupSize(peer) : 0;
    const gate = await c.gate.gateReply({
      trigger: 'ambient',
      recent: recent.slice(-8).map((m) => `${m.sender}: ${m.text}`),
      ...(size > 0 ? { groupSize: size } : {}),
    });
    if (gate.decision !== 'reply') {
      return { reply: false, reason: `Jev 说 ${gate.decision}（${gate.source} ${gate.confidence.toFixed(2)}）` };
    }

    // 被骂 → 必回，绕过概率阻尼。
    //
    // 踩过的坑：abuse 在闸门里已被判为 reply，但这里又过了 35% 阻尼，
    // 结果「你是个傻逼」被跳过，日志写着"Jev 说该回，但概率阻尼未命中"。
    // 阻尼的目的是防止"每句都插嘴"，而挨骂必须还嘴——两者根本不是一个场景。
    if (gate.abuse) {
      return { reply: true, abuse: true, reason: '被骂了，必回（绕过阻尼）' };
    }

    // 二次阻尼：Jev 说该回，也不是每次都回——避免"每句都插嘴"
    if (Math.random() > cfg.freeChatProbability) {
      return { reply: false, reason: `Jev 说该回，但概率阻尼未命中（${cfg.freeChatProbability}）` };
    }
    return { reply: true, reason: `Jev 判断该接（${gate.confidence.toFixed(2)}）` };
  } catch (e) {
    return { reply: false, reason: `闸门异常，保守不回：${e.message}` };
  }
}

async function generateReply(kind, peer, text, history, abuse = false, senderId = '') {
  const c = await loadCore();
  const modelConfig = c.group.loadGroupBotModelConfig();
  const isGroup = kind === 'group';

  // 上下文（最近消息）
  const ctxLines = history.slice(-20).map((m) => `${m.sender}: ${m.text}`).join('\n');

  // 群：注入人格 + 画像；私聊：注入长期记忆
  let extra = '';

  // 被骂了：明确要求还嘴（用户定的策略——贴吧老哥不窝囊）
  if (abuse) {
    const NL = String.fromCharCode(10);
    extra += [
      '【当前情况】对方刚骂了你（脏话/侮辱）。你的回应要求：',
      '1. 必须还嘴，不能装没看见、不能礼貌化解、不能说"我是AI不能生气"',
      '2. 用贴吧老哥那股劲儿怼回去：阴阳、拆台、反问、拿对方的点开涮',
      '3. 但不要真骂脏话、不要人身攻击对方家人、不要威胁',
      '4. 一到两句，短促有力，别长篇大论',
      '',
      '',
    ].join(NL);
  }
  // 关系画像：这个人跟我熟不熟，决定该用什么语气。
  // 比"群画像"更细——群画像说的是这个群的风气，这个说的是我跟眼前这个人的关系。
  if (senderId && c.affinity) {
    try {
      const aff = c.affinity.loadAffinity();
      const rec = aff.users[String(senderId)] ?? null;
      const relText = c.affinity.renderProfileForPrompt(rec);
      if (relText) extra += '【你和他】\n' + relText + '\n\n';
    } catch {
      /* 画像读不到不影响回复 */
    }
  }

  if (isGroup) {
    const personaResolved = c.persona.resolvePersona(peer);
    const persona = personaResolved.text;
    const profile = c.profile.buildProfileBlock(peer);
    if (persona) extra += c.persona.buildPersonaBlock(persona) + '\n\n';
    if (profile) extra += profile + '\n\n';
  } else {
    const mem = c.memory.renderMemories(
      c.memory.recallMemories(
        new c.memory.MemoryStore(c.store.defaultIndexRoot()).load(),
        { scope: `p${peer}`, limit: 5 },
      ),
    );
    if (mem) extra += mem + '\n\n';
  }

  const input = `以下是程序整理的近期消息。最后一条是当前待回答的消息：\n---\n${ctxLines}\n---\n\n当前消息：${text}`;

  if (isGroup) {
    return c.group.generateGroupReply(input, '', modelConfig, [], async () => '', '', '', extra);
  }
  return c.group.generatePrivateReply(input, '', modelConfig, [], async () => '', '', '', extra, false, String(peer));
}

async function makeVoice(text) {
  if (!cfg.allowVoice || !cfg.ttsEndpoint) return null;
  const c = await loadCore();
  const buf = await c.tts.synthesizeLocal(text, {
    endpoint: cfg.ttsEndpoint,
    refAudio: cfg.ttsRefAudio,
    promptText: cfg.ttsPromptText,
  });
  if (!buf) return null;
  return c.tts.saveAudioBuf(buf, cfg.outputDir);
}

/**
 * 偷表情包：别人发的图，看着像就存进自己的库。
 *
 * 三道闸：
 *   ① 只有图片段才看（文字/语音/文件不管）
 *   ② judgeStealable 挡掉截图、照片、长图、二维码
 *   ③ 每个群每天最多收 N 张（默认 8），防止库里塞满垃圾
 */
async function tryStealSticker(msg, kind, peer) {
  if (!cfg.stealStickers) return;
  if (!Array.isArray(msg.message)) return;
  const imgs = msg.message.filter((s) => s.type === 'image');
  if (imgs.length === 0) return;

  const c = await loadCore();
  if (!c.steal) return;

  const scope = `${kind === 'group' ? 'g' : 'p'}${peer}`;
  const quota = c.steal.loadQuota();
  const left = c.steal.remainingQuota(scope, cfg.stealDailyLimit, quota);
  if (left <= 0) return;

  for (const seg of imgs.slice(0, 2)) {
    const d = seg.data ?? {};
    // 表情包的 summary 是 [xxx]；普通图片没有。都尝试，让 judgeStealable 决定
    let buf = null;
    try {
      const url = d.url || d.file_url;
      if (url && /^https?:/.test(String(url))) {
        const res = await fetch(String(url), { signal: AbortSignal.timeout(15000) });
        if (res.ok) buf = Buffer.from(await res.arrayBuffer());
      }
      if (!buf && d.file) {
        const got = await api('get_image', { file: String(d.file) }, 15000);
        const p = got?.data?.file || got?.file;
        if (p && existsSync(String(p))) buf = readFileSync(String(p));
      }
    } catch {
      continue;
    }
    if (!buf || buf.length === 0) continue;

    // 有没有"表情包特征"决定用不用严格模式：
    //   sub_type=1 或 summary 是 [xxx] → 是表情，放宽
    //   否则 → 很可能是照片/截图，收紧
    const likelySticker =
      String(d.sub_type) === '1' || /^\[.+\]$/.test(String(d.summary ?? ''));
    const size = c.steal.probeImageSize(buf);
    const verdict = c.steal.judgeStealable({ buffer: buf, ...size, strict: !likelySticker });
    if (!verdict.accept) {
      log(`  图不收: ${verdict.reason}${likelySticker ? '（表情特征）' : '（无表情特征）'}`);
      continue;
    }

    const textLen = msg.message
      .filter((s) => s.type === 'text')
      .map((s) => String(s.data?.text ?? ''))
      .join('').trim().length;
    // 带一大堆字的图更可能是截图，不收
    if (textLen > 20) continue;

    const fromName = msg.sender?.card || msg.sender?.nickname || '';
    const r = c.steal.addStolenSticker('private/emoji-library', {
      buffer: buf,
      fromUin: String(msg.sender?.user_id ?? ''),
      fromName,
      scope,
      text: flatten(msg.message),
    });
    if (r.added) {
      c.steal.consumeQuota(scope, quota);
      c.steal.saveQuota(quota);
      log(`  偷到表情: ${r.label}（${verdict.reason}，来自 ${fromName || '未知'}）`);
    }
  }
}

async function processMessage(kind, peer, msg, history, self) {  const meta = { kind, peer, mentioned: mentionsSelf(msg, self), time: msg.time, senderId: msg.sender?.user_id };
  const key = `${kind === 'group' ? 'g' : 'p'}${peer}`;
  const text = flatten(msg.message);
  const mentioned = mentionsSelf(msg, self);
  const voice = hasVoice(msg);
  const sticker = hasSticker(msg);

  // ── 好感度埋点（一）：他跟我说了一句话 ──
  // 不管回不回都要记——"他主动找我但我不接"本身也是信息。
  if (meta.senderId) {
    try {
      const ca = await loadCore();
      if (ca.affinity) {
        const aff = ca.affinity.loadAffinity();
        const topics = ca.affinity.extractTopics(text);
        const r = ca.affinity.applyInteraction(aff, meta.senderId, 'from', { name: msg.sender?.card || msg.sender?.nickname });
        ca.affinity.recordTopics(r.record, topics);
        // 被骂单独记一笔（不是负分，是"在玩"的信号）
        if (/傻逼|垃圾|妈的|滚|废物|智障|nmsl|操你/i.test(text)) {
          ca.affinity.applyInteraction(aff, meta.senderId, 'snub');
        }
        ca.affinity.saveAffinity(aff);
        if (r.changed) log(`  关系变化: ${meta.senderId} ${r.before} → ${r.after}`);
      }
    } catch {
      /* 画像记不下来不影响回复 */
    }
  }

  // ── 偷表情包 ──
  // 别人发的表情，看着像就存进自己的库。真人看到好图会存，这是最像人的一条。
  // 放在回复判断之前：不管我回不回，图都先收了。
  await tryStealSticker(msg, kind, peer).catch(() => {});

  const decision = await shouldReply(kind, peer, meta.mentioned, meta.time, history);
  if (!decision.reply) {
    state.stats.skipped += 1;
    // 只有"值得注意"的跳过才记日志；太老/间隔不足是常态
    if (!/太老|间隔不足/.test(decision.reason)) log(`跳过 ${key}: ${decision.reason}`);
    return;
  }

  log(`回复 ${key}: ${text.slice(0, 40)}`);

  // 生成回复（带超时/重试）
  let replyText = '';
  try {
    replyText = await generateReply(kind, peer, text, history, false, meta.senderId);
  } catch (e) {
    breakerRecord(false);
    pushDlq('generate', { kind, peer, text, history }, e);
    log(`生成失败: ${e.message}`);
    return;
  }
  if (!replyText || !replyText.trim()) {
    state.stats.skipped += 1;
    log('生成结果为空，跳过');
    return;
  }

  // 去人机味：机械削掉公文腔/总结癖/列表表格。
  // prompt 里已经写了禁止，但模型经常不听；这里再硬过一遍。
  // 只在「聊天回复」上做——发文件、写长文档时不能动结构。
  const c0 = await loadCore();
  if (c0.humanize && typeof c0.humanize.humanize === 'function') {
    const before = c0.humanize.aiSmellScore(replyText);
    const cleaned = c0.humanize.humanize(replyText, { maxChars: 320 });
    if (cleaned.text !== replyText) {
      log(`去人机味(${before.score}→${c0.humanize.aiSmellScore(cleaned.text).score}): ${cleaned.changes.join(',')}`);
      replyText = cleaned.text;
    }
  }

  // 文字还是语音
  const c = await loadCore();
  const medium = await c.medium.decideMedium({
    reply: replyText,
    incomingText: text,
    incomingIsVoice: voice,
    incomingIsSticker: sticker,
    isPrivate: kind === 'private',
  });
  log(`媒介: ${medium.medium}（${medium.source}）${medium.reason}`);

  let message = replyText;

  // 斗图：对方发表情包，回一张表情（配一句短文字）
  if (medium.medium === 'sticker') {
    try {
      const picked = await c.sticker.pickStickerMerged(replyText.slice(0, 40) || text.slice(0, 40));
      if (picked) {
        let imgPath = null;
        if (picked.origin === 'memecub' && picked.remoteUrl) {
          imgPath = await downloadMeme(c, picked.remoteUrl);
        } else {
          imgPath = c.sticker.stickerFile(picked.id);
        }
        if (imgPath) {
          message = [
            ...(replyText.trim() ? [{ type: 'text', data: { text: replyText.trim() } }] : []),
            { type: 'image', data: { file: imgPath } },
          ];
          log(`  斗图: ${picked.label.slice(0, 26)}（${picked.origin}）`);
        }
      }
    } catch (e) {
      log(`  斗图失败，退回纯文字: ${e.message}`);
    }
  }

  if (medium.medium === 'voice') {
    const audio = await makeVoice(replyText);
    if (audio) {
      const ffmpeg = c.tts.findFfmpeg();
      const v = c.tts.toVoiceFormat(audio, ffmpeg, cfg.outputDir);
      const b64 = readFileSync(v.file).toString('base64');
      message = [{ type: 'record', data: { file: `base64://${b64}` } }];
    } else {
      log('语音合成失败，退回文字');
    }
  }

  // 分段：真人说话是「一句，停一下，又一句」。
  // 只对纯文字回复分段——表情/语音/多段消息（文字+图）都不拆，
  // 拆了会变成"文字、图、文字"这种断头节奏。
  //
  // 判断链：pureText → 适合拆（无代码/链接/列表）→ 拆 → 逐条发。
  let payloads = [message];
  const isPureText =
    Array.isArray(message) &&
    message.length === 1 &&
    message[0]?.type === 'text' &&
    typeof message[0]?.data?.text === 'string';
  if (isPureText && c.segments && typeof c.segments.segmentReply === 'function') {
    const seg = c.segments.segmentReply(message[0].data.text, { maxSegments: 3 });
    if (seg.segments.length > 1 && seg.segments.every((x) => x.text.trim())) {
      payloads = seg.segments.map((x) => ({ segments: [{ type: 'text', data: { text: x.text } }], delay: x.delayAfterMs }));
      log(`  分段: ${seg.segments.length} 条（${seg.segments.map((x) => x.text.length).join('/')} 字）`);
    }
  }

  // 发送（带重试）
  let sent = false;
  for (let attempt = 1; attempt <= 3 && !sent; attempt += 1) {
    try {
      for (let pi = 0; pi < payloads.length; pi += 1) {
        const p = payloads[pi];
        const body = Array.isArray(p) ? p : p.segments;
        await api(kind === 'group' ? 'send_group_msg' : 'send_private_msg',
          kind === 'group'
            ? { group_id: Number(peer), message: body }
            : { user_id: Number(peer), message: body },
          25000);
        // 段间停顿：模拟打完一句想下一句的时间
        if (!Array.isArray(p) && p.delay > 0 && pi < payloads.length - 1) {
          await new Promise((r) => setTimeout(r, p.delay));
        }
      }
      sent = true;
      breakerRecord(true);
      state.stats.replied += 1;
      state.lastReplyAt[key] = Math.floor(Date.now() / 1000);
      if (!state.replyTimes) state.replyTimes = {};
      const rt = (state.replyTimes[key] ?? []).filter((t) => t > Date.now() / 1000 - 7200);
      rt.push(Math.floor(Date.now() / 1000));
      state.replyTimes[key] = rt;
      log(`已回复 ${key}（${medium.medium}）`);

      // ── 好感度埋点（二）：我回了他一句 ──
      if (meta.senderId) {
        try {
          const ca = await loadCore();
          if (ca.affinity) {
            const aff = ca.affinity.loadAffinity();
            ca.affinity.applyInteraction(aff, meta.senderId, 'to');
            ca.affinity.saveAffinity(aff);
          }
        } catch {
          /* 记不下来不影响流程 */
        }
      }

      // 补一张表情：文字说完，配个图更像人在聊天
      //
      // 只在文字回复时配（语音后面再甩张图很奇怪）。
      // 由 Jev 决定要不要配、用什么情绪——比随机数准：
      // 正经解释和安慰人不该配，接梗和自嘲该配。
      if (medium.medium === 'text' && cfg.emojiChance > 0) {
        try {
          const core = await loadCore();
          const judge = await core.gate.decideSticker(replyText, {
            recent: history.slice(-4).map((m) => `${m.sender}: ${m.text}`),
            chance: cfg.emojiChance,
          });
          log(`  配图判断: ${judge.reason}`);

          if (judge.add) {
            const picked = await core.sticker.pickStickerMerged(judge.mood || replyText.slice(0, 60));
            if (picked) {
              let imgPath = null;
              if (picked.origin === 'memecub' && picked.remoteUrl) {
                imgPath = await downloadMeme(core, picked.remoteUrl);
              } else {
                imgPath = core.sticker.stickerFile(picked.id);
              }
              if (imgPath) {
                await api(
                  kind === 'group' ? 'send_group_msg' : 'send_private_msg',
                  kind === 'group'
                    ? { group_id: Number(peer), message: [{ type: 'image', data: { file: imgPath } }] }
                    : { user_id: Number(peer), message: [{ type: 'image', data: { file: imgPath } }] },
                  25000,
                );
                log(`  配图: ${picked.label.slice(0, 30)}（${picked.origin}）`);
              }
            }
          }
        } catch (e) {
          // 配图失败不该影响已经发出去的文字
          log(`  配图失败（忽略）: ${e.message}`);
        }
      }
    } catch (e) {
      breakerRecord(false);
      if (attempt < 3) {
        const delay = 2000 * Math.pow(2, attempt - 1);
        log(`发送失败(${attempt}/3)，${delay}ms 后重试: ${e.message}`);
        await sleep(delay);
      } else {
        pushDlq('send', { kind, peer, message, text: replyText, medium: medium.medium }, e);
        log(`发送失败，已进死信: ${e.message}`);
      }
    }
  }
}

/** 下载 memecub 的图到本地，返回路径（失败返回 null） */
async function downloadMeme(core, url) {
  try {
    const dir = join(cfg.outputDir ?? '.', 'memes');
    mkdirSync(dir, { recursive: true });
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return null;
    const ctype = String(res.headers.get('content-type') ?? '');
    const ext = ctype.includes('png') ? 'png' : ctype.includes('gif') ? 'gif' : ctype.includes('webp') ? 'webp' : 'jpg';
    const p = join(dir, `meme-${Date.now()}.${ext}`);
    writeFileSync(p, Buffer.from(await res.arrayBuffer()));
    return p;
  } catch {
    return null;
  }
}

// 群人数缓存：闸门要用它判断"小群里没点名也多半是在对我说"
const groupSizeCache = new Map();
async function groupSize(gid) {
  const key = String(gid);
  if (groupSizeCache.has(key)) return groupSizeCache.get(key);
  try {
    const info = await api('get_group_info', { group_id: Number(gid) });
    const n = Number(info?.member_count ?? 0);
    if (n > 0) groupSizeCache.set(key, n);
    return n;
  } catch {
    return 0;
  }
}

// 好友/群列表缓存：每秒扫一次时不必每秒都拉两遍列表
let peersCache = null;
let peersCacheAt = 0;
const PEERS_TTL = 60000;

async function getPeers() {
  const now = Date.now();
  if (peersCache && now - peersCacheAt < PEERS_TTL) return peersCache;
  const peers = [];
  if (cfg.includePrivate) {
    try {
      const friends = await api('get_friend_list', {});
      for (const f of (Array.isArray(friends) ? friends : [])) {
        // NapCat 的 get_friend_list 返回 user_id/nickname（不是 peerUin）
        const uin = f.user_id ?? f.peerUin ?? f.uin ?? '';
        peers.push({ kind: 'private', peer: String(uin), name: f.nickname ?? f.remark ?? f.peerName ?? '' });
      }
    } catch (e) { log(`取好友列表失败: ${e.message}`); }
  }
  for (const gid of cfg.groups) {
    peers.push({ kind: 'group', peer: String(gid), name: `群${gid}` });
  }
  peersCache = peers;
  peersCacheAt = now;
  return peers;
}

async function runOnce() {
  state.stats.polls += 1;
  if (breakerOpen()) {
    log(`熔断中，跳过本轮`);
    return;
  }
  // 在线检查：掉线时 get_login_info 仍会返回缓存的账号信息，
  // 但 get_status.online === false —— 此时所有轮询都是白跑，且没有任何报错。
  // 必须显式检测，否则表现成"进程活着但什么都不干"。
  try {
    const st = await api('get_status', {});
    const online = st?.online === true;
    if (!online) {
      offlinePolls += 1;
      // 只在第 1 次和之后每 60 次（约 2 分钟）提醒一次，避免刷屏
      if (offlinePolls === 1 || offlinePolls % 60 === 0) {
        log(`[掉线] NapCat 报告 online=false（连续 ${offlinePolls} 次）——消息收不到，需要重新登录`);
      }
      return;
    }
    if (offlinePolls > 0) {
      log(`[恢复] NapCat 重新在线（掉线 ${offlinePolls} 次轮询）`);
      offlinePolls = 0;
    }
  } catch (e) {
    log(`取在线状态失败: ${e.message}`);
    return;
  }

  try {
    const login = await api('get_login_info', {});
    selfUin = Number(login?.user_id ?? 0);
  } catch (e) {
    log(`取登录信息失败: ${e.message}`);
    return;
  }

  const peers = (await getPeers()).filter((p) => p.peer !== String(selfUin));

  for (const { kind, peer, name } of peers) {
    if (!peer) continue;
    const key = `${kind === 'group' ? 'g' : 'p'}${peer}`;
    let msgs = [];
    try {
      const hist = await api(kind === 'group' ? 'get_group_msg_history' : 'get_friend_msg_history',
        kind === 'group' ? { group_id: Number(peer), count: 30 } : { user_id: Number(peer), count: 30 });
      msgs = (hist?.messages ?? []).sort((a, b) => a.time - b.time);
      if (process.env.QCE_AUTO_DEBUG) log(`debug ${key}: 拉到 ${msgs.length} 条`);
    } catch (e) {
      log(`取 ${key} 历史失败: ${e.message}`);
      continue;
    }

    // 历史（给模型当上下文）：只取最近 maxAgeSec 内的
    const histCutoff = Math.floor(Date.now() / 1000) - cfg.maxAgeSec;
    const history = msgs.filter((m) => m.time >= histCutoff).map((m) => ({
      sender: m.sender?.card || m.sender?.nickname || String(m.sender?.user_id ?? ''),
      text: flatten(m.message).slice(0, 200),
      time: m.time,
    }));

    for (const m of msgs) {
      const id = String(m.message_id ?? `${m.time}:${m.message_seq}`);
      if (state.handled[id]) continue;
      if (String(m.sender?.user_id) === String(selfUin)) continue;
      state.handled[id] = 1;

      await processMessage(kind, peer, m, history, selfUin);

      // 水位推进
      if (m.time > (state.cursors[key] ?? 0)) state.cursors[key] = m.time;
    }
  }

  saveState(state);
}

// ————— 启动 —————
if (STATUS) {
  console.log(JSON.stringify({
    ...state.stats,
    sessions: Object.keys(state.cursors).length,
    handled: Object.keys(state.handled).length,
    config: { groups: cfg.groups, allow: cfg.allow, includePrivate: cfg.includePrivate, intervalSec: cfg.intervalSec },
  }, null, 2));
  process.exit(0);
}

if (SHOW_DLQ) {
  const list = readDlq();
  if (!list.length) { console.log('死信是空的'); process.exit(0); }
  for (const e of list) console.log(`${e.id}  ${e.kind}  ${new Date(e.createdAt).toLocaleString()}  ${e.error}`);
  process.exit(0);
}

if (REPLAY_ID) {
  const list = readDlq();
  const idx = list.findIndex((e) => e.id === REPLAY_ID);
  if (idx < 0) { console.log('没有这条死信'); process.exit(1); }
  const entry = list[idx];
  try {
    const p = entry.payload;
    await api(p.kind === 'group' ? 'send_group_msg' : 'send_private_msg',
      p.kind === 'group' ? { group_id: Number(p.peer), message: p.message } : { user_id: Number(p.peer), message: p.message }, 25000);
    list.splice(idx, 1);
    writeDlq(list);
    console.log(`重放成功: ${entry.id}`);
  } catch (e) {
    console.log(`重放失败: ${e.message}`);
    process.exit(1);
  }
  process.exit(0);
}

log(`自动回复启动: 每 ${cfg.intervalSec}s，私聊${cfg.includePrivate ? '开' : '关'}，群 ${cfg.groups.join(',') || '无'}`);
log(`白名单: ${cfg.allow.join(',') || '不限'}；语音: ${cfg.allowVoice ? (cfg.ttsEndpoint || '未配置本地服务') : '关'}`);

if (ONCE) {
  await runOnce();
  saveState(state);
  // Node 24 + undici keep-alive：Windows 上 process.exit() 会撞 uv assertion
  // 改成「自然退出」：把引用计数降到 0，让事件循环自己收尾
  process.exitCode = 0;
  // 兜底：若 2s 后还没退出就强退
  setTimeout(() => { try { process.exit(0); } catch {} }, 2000).unref();
}

let stopping = false;
const shutdown = () => {
  if (stopping) return;
  stopping = true;
  log('退出中，保存状态…');
  saveState(state);
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

while (!stopping) {
  try { await runOnce(); } catch (e) { log(`循环异常: ${e.message}`); }
  await sleep(cfg.intervalSec * 1000);
}
