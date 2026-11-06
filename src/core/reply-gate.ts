/**
 * 回复闸门：决定「这条消息要不要接」。
 *
 * 现状（v0.16 之前）：纯确定性规则 —— 群里必须 @ 到机器人、私聊必须在白名单里。
 * 这里加一层 Jev 决策：让它在一个 choice 问题里选 reply / wait / skip，
 * 带校准置信度；置信度不够就回落到确定性规则，绝不因为模型抽风而漏回或乱回。
 *
 * 纯逻辑（请求体、结果解析、回落）与网络分开，便于单测。
 */
import { JEV_ENDPOINT, JEV_MODEL } from './sticker.js';

export type GateDecision = 'reply' | 'wait' | 'skip';

export interface GateContext {
  /** 触发原因：@我 / 白名单私聊 / 没 @ 但在聊我关心的事 */
  trigger: 'mention' | 'private' | 'ambient';
  /** 最近几条消息原文（不含指令性包装） */
  recent: string[];
  /** 机器人自己最后一条回复的时间距今秒数（可选） */
  sinceLastReplySec?: number;
  /**
   * 群人数（仅群聊有意义）。
   *
   * 为什么需要：两人群里有人说「你在干嘛」，显然是冲我来的；
   * 但 Jev 只看文本时给不出这个判断（实测 0.30 把握就跳过了）。
   */
  groupSize?: number;
}

export interface GateResult {
  decision: GateDecision;
  confidence: number;
  source: 'jev' | 'rules';
  reason?: string;
  /** 这条是被骂了——回复时要还嘴，不是正常搭话 */
  abuse?: boolean;
}

/**
 * 三个选项的判据。
 *
 * 写法上刻意把「情绪共鸣」单列——这是之前踩过的坑：
 * 原判据只写了"直接找我 / 能推进对话"，于是有人甩出糗事求共鸣时，
 * Jev 只给 0.44 把握，被判成"路人闲聊"。但朋友群里接一句
 * "哈哈哈哈太惨了"是完全正常的行为，不是打扰。
 */
export const GATE_CRITERIA: Record<GateDecision, string> = {
  reply:
    '该我接话：① 有人甩出糗事/吐槽/段子/情绪宣泄，需要有人共鸣一句（"哈哈哈哈太惨了""这也太离谱了"）；' +
    '② 消息直接找我或问我；' +
    '③ 我接一句能推进话题、补充信息或活跃气氛',
  wait:
    '先别接，再等一两句：话题正在快速轮转、我一插就打断节奏；' +
    '或者几个人正在争论，我不该选边；或者还没轮到我说',
  skip:
    '不该我说话：纯事务通知、复读刷屏、广告、表情包连发；' +
    '或者别人在约线下活动/私事、在吵架，我插话只会尴尬',
};

/** 构造 Jev 请求：一个 state（触发原因 + 群规模 + 最近消息），一个 choice 问题 */
export function buildGateBody(context: GateContext): Record<string, unknown> {
  const recent = context.recent.slice(-10).map((m, i) => `[#${i}] ${m}`).join('\n');

  // 小群提示：两人群里「你在干嘛」显然是冲我来的，但纯看文本 Jev 给不出这判断
  //（实测 0.30 把握就跳过了）。所以把群规模作为事实喂进去。
  const sizeLine =
    typeof context.groupSize === 'number' && context.groupSize > 0
      ? context.groupSize <= 3
        ? `群人数：${context.groupSize}（很小的群，没点名的消息也多半是在对你说话）`
        : `群人数：${context.groupSize}`
      : '';

  return {
    model: JEV_MODEL,
    state: [`触发原因：${context.trigger}`, sizeLine, `最近消息：\n${recent}`].filter(Boolean).join('\n'),
    questions: {
      m0: {
        type: 'choice',
        instructions:
          '你是一个常驻群里的朋友，不是客服机器人。判断这一条现在该不该接话。' +
          '注意：有人分享糗事或吐槽时不接反而奇怪；但也不要每句都插嘴。',
        criteria: GATE_CRITERIA,
      },
    },
  };
}

/** 解析并校验（choice 必须是三个之一），无效返回 null */
export function parseGateAnswer(payload: unknown): { decision: GateDecision; confidence: number } | null {
  const answer = (payload as any)?.answers?.m0;
  const choice = answer?.choice;
  if (choice !== 'reply' && choice !== 'wait' && choice !== 'skip') return null;
  const confidence = Number(answer?.confidence);
  return { decision: choice, confidence: Number.isFinite(confidence) ? confidence : 0.5 };
}

/** 确定性兜底：@我必回、私聊必回、ambient 默认跳过 */
export function rulesDecision(context: GateContext): GateResult {
  if (context.trigger === 'mention') return { decision: 'reply', confidence: 1, source: 'rules', reason: '@ 到我' };
  if (context.trigger === 'private') return { decision: 'reply', confidence: 1, source: 'rules', reason: '白名单私聊' };
  return { decision: 'skip', confidence: 1, source: 'rules', reason: '没有点名，默认不插话' };
}

export interface GateOptions {
  apiKey?: string;
  endpoint?: string;
  /** 低于这个置信度就回落到规则 */
  minConfidence?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * 决策入口：先问 Jev，置信度不够或调用失败就回落到规则。
 */
export async function gateReply(context: GateContext, options: GateOptions = {}): Promise<GateResult> {
  // 被骂 → 必回必还嘴。这条**优先于一切**，包括 Jev 和"没点名默认不插话"。
  //
  // 理由（用户定的策略）：这是贴吧老哥人设，被骂了不回显得窝囊。
  // 而且实测 Jev 对被骂只给 0.34 把握，然后回落到规则跳过——
  // 所以这里必须前置，不能指望 Jev。
  const lastMsg = context.recent[context.recent.length - 1] ?? '';
  const body = lastMsg.replace(/^[^:：]*[:：]\s*/, '');   // 去掉 "昵称: " 前缀
  if (detectAbuse(body, { groupSize: context.groupSize, mentioned: context.trigger === 'mention' })) {
    return { decision: 'reply', confidence: 1, source: 'rules', reason: '被骂了，必须还嘴', abuse: true };
  }

  const apiKey = options.apiKey ?? process.env.JEV_API_KEY ?? '';
  const minConfidence =
    options.minConfidence ?? Number(process.env.QCE_GATE_MIN_CONFIDENCE ?? 0.55);
  if (!apiKey) return { ...rulesDecision(context), reason: `${rulesDecision(context).reason}（未配 JEV_API_KEY）` };

  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(options.endpoint ?? JEV_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(buildGateBody(context)),
      signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
    });
    if (!res.ok) return rulesDecision(context);
    const parsed = parseGateAnswer(await res.json());
    if (!parsed) return rulesDecision(context);
    if (parsed.confidence < minConfidence) {
      const fallback = rulesDecision(context);
      return { ...fallback, reason: `Jev 只有 ${parsed.confidence.toFixed(2)} 把握（${parsed.decision}），回落到规则：${fallback.reason}` };
    }
    return { decision: parsed.decision, confidence: parsed.confidence, source: 'jev' };
  } catch {
    return rulesDecision(context);
  }
}

/**
 * 骂人识别：判断这句话是不是在骂我。
 *
 * 为什么用关键词而不是 Jev：实测 Jev 对被骂给的把握只有 0.34-0.35，
 * 然后回落到规则（ambient → skip），于是「被骂必还嘴」这个策略永远不触发。
 * 关键词是确定性的，正好补上这个洞。
 *
 * 为什么还要判「是不是骂我」：真群里脏话满天飞，但多半是骂别人、骂游戏、骂天气。
 * 只有同时满足「有脏话」+「指向我」才算——小群、@ 我、或用了第二人称"你"。
 */
export function detectAbuse(text: string, context: { groupSize?: number; mentioned?: boolean } = {}): boolean {
  const t = String(text ?? '');
  if (!t.trim()) return false;

  // 带明确攻击对象的脏话（避免"我操"这种语气词误判）
  // 只收「明确在骂人」的，不收语气词。
  //
  // 特别注意「你妈的」：它常作语气助词用（「你妈的，我手机掉了」），
  // 不加限定会误判成被骂。只有「去你妈的 / 操你妈」这种才是指向性辱骂。
  const PATTERNS = [
    /傻[逼比Bb屄]/, /煞笔/, /沙比/, /智障/, /脑残/, /弱智/, /废物/,
    /去你妈的/, /操你妈/, /草你妈/, /日你妈/, /干你妈/, /你妈死了/, /死全家/,
    /滚[蛋吧出]/, /狗东西/, /狗日的/, /杂种/, /贱人/, /畜生/, /去死吧/,
  ];
  if (!PATTERNS.some((re) => re.test(t))) return false;

  // 指向判断：必须是冲我来的。
  //
  // 只用"小群"当依据会误判——两人群里「这游戏真垃圾」骂的是游戏，不是我（实测踩过）。
  // 所以要求至少一个明确指向：@我 / 提到机器人 / 第二人称"你"。
  if (context.mentioned) return true;
  if (/机器人|朝闻|这bot|the bot/i.test(t)) return true;
  return /你/.test(t);
}

/** 配图决策的结果 */
export interface StickerDecision {
  /** 要不要补一张表情 */
  add: boolean;
  /** 用什么情绪去找图（Jev 给的关键词，空则用回复原文） */
  mood: string;
  confidence: number;
  source: 'jev' | 'random';
  reason?: string;
}

/**
 * 让 Jev 判断「这条回复该不该补一张表情」，顺便给出找图的情绪词。
 *
 * 为什么换掉随机数：随机只保证频率，不保证合适。
 * 「我这就去死」和「哈哈哈太惨了」都是回复，但前者配图很怪。
 * Jev 能按语义判断，而且顺手给出情绪词——比我们手写的同义词表准。
 *
 * 一次请求决定两件事（要不要 + 什么情绪），不多花一次调用。
 * Jev 不可用或置信度不够时回落随机，保证功能不会因为 Jev 挂了就消失。
 */
export async function decideSticker(
  reply: string,
  context: { recent?: string[]; chance?: number } = {},
  options: GateOptions = {},
): Promise<StickerDecision> {
  const fallback = (): StickerDecision => ({
    add: Math.random() < (context.chance ?? 0.35),
    mood: '',
    confidence: 1,
    source: 'random',
    reason: 'Jev 不可用，回落随机',
  });

  const apiKey = options.apiKey ?? process.env.JEV_API_KEY ?? '';
  if (!apiKey) return fallback();

  const recent = (context.recent ?? []).slice(-4).join('\n');
  const body = {
    model: JEV_MODEL,
    state: `最近的对话：\n${recent}\n\n我刚生成了一条回复：\n${reply}`,
    questions: {
      m0: {
        type: 'choice',
        instructions:
          '判断这条回复后面该不该补一张表情包。' +
          '表情包是用来加语气、接梗、自嘲的；正经解释、报错说明、安慰别人时不该配。',
        criteria: {
          add: '该配：这条回复情绪明确（好笑/无语/生气/委屈/得意/摆烂），配张图更生动',
          skip: '不该配：这条是正经解释/回答问题/安慰人/说事实，配图反而显得轻浮',
        },
      },
      // 注意：Jev 只支持 noul / choice / score / box 四种题型，**没有 text**。
      // 用 text 会让整个请求 400，然后静默回落到随机——踩过一次。
      m1: {
        type: 'choice',
        instructions: '如果要配图，用哪种情绪的表情最贴？',
        criteria: {
          laugh: '笑哭 / 好笑 / 太惨了',
          speechless: '无语 / 离谱 / 服了',
          angry: '生气 / 怼人 / 不服',
          sad: '委屈 / 难过 / 破防',
          slack: '摆烂 / 躺平 / 累',
          smug: '得意 / 嘲讽 / 阴阳',
          shock: '震惊 / 懵圈 / 啊这',
        },
      },
    },
  };

  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(options.endpoint ?? JEV_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
    });
    if (!res.ok) return fallback();
    const json: any = await res.json();

    const choice = json?.answers?.m0?.choice;
    const confidence = Number(json?.answers?.m0?.confidence);
    if (choice !== 'add' && choice !== 'skip') return fallback();
    if (!Number.isFinite(confidence) || confidence < (options.minConfidence ?? 0.55)) return fallback();

    const MOOD_WORDS: Record<string, string> = {
      laugh: '笑哭', speechless: '无语', angry: '生气',
      sad: '委屈', slack: '摆烂', smug: '嘲讽', shock: '震惊',
    };
    const rawMood = String(json?.answers?.m1?.choice ?? '');
    const mood = MOOD_WORDS[rawMood] ?? '';

    return {
      add: choice === 'add',
      mood,
      confidence,
      source: 'jev',
      reason: `Jev 判断${choice === 'add' ? '该配' : '不配'}（${confidence.toFixed(2)}）${mood ? `，情绪「${mood}」` : ''}`,
    };
  } catch {
    return fallback();
  }
}
