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
}

export interface GateResult {
  decision: GateDecision;
  confidence: number;
  source: 'jev' | 'rules';
  reason?: string;
}

export const GATE_CRITERIA: Record<GateDecision, string> = {
  reply: '消息在直接找我，或者我接一句能推进对话，值得回',
  wait: '不是找我，但话题跟我有关或马上会轮到我，再等一两句',
  skip: '纯路人闲聊、刷屏、广告、我插话只会尴尬',
};

/** 构造 Jev 请求：一个 state（触发原因 + 最近消息），一个 choice 问题 */
export function buildGateBody(context: GateContext): Record<string, unknown> {
  const recent = context.recent.slice(-10).map((m, i) => `[#${i}] ${m}`).join('\n');
  return {
    model: JEV_MODEL,
    state: `触发原因：${context.trigger}\n最近消息：\n${recent}`,
    questions: {
      m0: {
        type: 'choice',
        instructions: '作为群里的聊天参与者，判断我现在应该回复、再等等，还是跳过。',
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
  const apiKey = options.apiKey ?? process.env.JEV_API_KEY ?? '';
  const minConfidence = options.minConfidence ?? 0.6;
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
