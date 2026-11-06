/**
 * 该发文字还是语音？
 *
 * 两层判断：
 *   1. 硬规则（确定性）：对方发的是语音 → 回语音；说了"唱个歌/说句话/听听声音"→ 语音
 *   2. Jev（语义）：判断这条回复"念出来"是否更自然
 *
 * 硬规则优先——因为"对方发语音我回文字"这种体验不一致的情况不该交给概率。
 */
import { JEV_ENDPOINT, JEV_MODEL } from './sticker.js';

export type ReplyMedium = 'text' | 'voice' | 'sticker';

export interface MediumInput {
  /** 我要回复的内容 */
  reply: string;
  /** 对方这条消息的文本 */
  incomingText?: string;
  /** 对方这条消息是不是语音 */
  incomingIsVoice?: boolean;
  /** 对方这条消息是不是图片 */
  incomingIsImage?: boolean;
  /**
   * 对方这条消息是不是**表情包**（斗图用的那种，不是随手拍的照片）。
   *
   * 为什么和图片分开：斗图场景下回一张表情才叫接招，回一段文字等于认输。
   * 但对方发的是截图/照片时，回表情就很怪——那是要看内容的。
   */
  incomingIsSticker?: boolean;
  /** 当前会话是不是私聊 */
  isPrivate?: boolean;
}

export interface MediumDecision {
  medium: ReplyMedium;
  reason: string;
  source: 'rules' | 'jev';
  confidence: number;
}

/** 触发语音的关键词 */
const VOICE_TRIGGERS = [
  '唱', '唱个', '唱一首', '来首歌', '唱歌',
  '听听', '听一下', '听你说', '听听你的', '你的声音', '声音好听',
  '说句话', '说两句', '念一下', '读一下', '念出来', '语音', '发个语音', '语音条',
  'speak', 'voice', 'sing',
];

/** 触发文字的关键词（明确说别发语音） */
const TEXT_TRIGGERS = [
  '打字', '发字', '文字回', '别发语音', '不要语音', '文字就行',
];

/** 硬规则：确定性判断 */
export function rulesMedium(input: MediumInput): MediumDecision {
  const text = `${input.incomingText ?? ''} ${input.reply}`.toLowerCase();

  if (TEXT_TRIGGERS.some((k) => text.includes(k))) {
    return { medium: 'text', reason: '对方明确要求打字', source: 'rules', confidence: 1 };
  }
  if (input.incomingIsVoice) {
    return { medium: 'voice', reason: '对方发的是语音，回语音更自然', source: 'rules', confidence: 1 };
  }
  // 斗图：对方发表情包，回一张才叫接招
  if (input.incomingIsSticker) {
    return { medium: 'sticker', reason: '对方发的是表情包，斗图得回图', source: 'rules', confidence: 1 };
  }
  if (VOICE_TRIGGERS.some((k) => text.includes(k))) {
    return { medium: 'voice', reason: '对方要求听声音/唱歌', source: 'rules', confidence: 1 };
  }
  return { medium: 'text', reason: '默认发文字', source: 'rules', confidence: 1 };
}

/** 构造 Jev 请求 */
export function buildMediumBody(input: MediumInput): Record<string, unknown> {
  return {
    model: JEV_MODEL,
    state: [
      `对方发的：${input.incomingIsVoice ? '一条语音' : input.incomingIsImage ? '一张图片' : '一段文字'}`,
      `对方内容：${input.incomingText ?? '(无法转成文字)'}`,
      `我准备回的：${input.reply.slice(0, 200)}`,
    ].join('\n'),
    questions: {
      m0: {
        type: 'choice',
        instructions: '判断这条回复用文字还是语音更合适。默认文字；只有当语音明显更自然或对方明确要听声音时才选语音。',
        criteria: {
          text: '文字更合适：信息量大、需要看内容、或者对方没提要听声音',
          voice: '语音更合适：对方明确要听声音/唱歌，或者短句念出来更有味道',
        },
      },
    },
  };
}

/** 解析 Jev 答案 */
export function parseMediumAnswer(payload: unknown): { medium: ReplyMedium; confidence: number } | null {
  const a = (payload as any)?.answers?.m0;
  const choice = a?.choice;
  if (choice !== 'text' && choice !== 'voice') return null;
  const confidence = Number(a?.confidence);
  return { medium: choice, confidence: Number.isFinite(confidence) ? confidence : 0.5 };
}

export interface MediumOptions {
  apiKey?: string;
  endpoint?: string;
  minConfidence?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * 决定用文字还是语音。硬规则命中就返回；否则问 Jev，置信度不够回落到文字。
 */
export async function decideMedium(input: MediumInput, options: MediumOptions = {}): Promise<MediumDecision> {
  const rules = rulesMedium(input);
  // 确定性命中（语音触发/要求打字/对方发语音）不再问模型
  if (rules.source === 'rules' && rules.medium === 'voice') return rules;
  if (rules.reason === '对方明确要求打字') return rules;

  const apiKey = options.apiKey ?? process.env.JEV_API_KEY ?? '';
  if (!apiKey) return rules;

  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(options.endpoint ?? JEV_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(buildMediumBody(input)),
      signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
    });
    if (!res.ok) return rules;
    const parsed = parseMediumAnswer(await res.json());
    if (!parsed) return rules;
    if (parsed.confidence < (options.minConfidence ?? 0.6)) {
      return { ...rules, reason: `Jev 只有 ${parsed.confidence.toFixed(2)} 把握（${parsed.medium}），保持文字` };
    }
    return { medium: parsed.medium, reason: `Jev 判断 ${parsed.medium}`, source: 'jev', confidence: parsed.confidence };
  } catch {
    return rules;
  }
}
