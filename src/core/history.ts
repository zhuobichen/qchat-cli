/**
 * 群消息拉取（分页 + 去重 + 消息段拍平）。
 * digest / search / mcp 共用，避免三处各写一遍。
 */

export interface FlatMessage {
  id: string;
  groupId: number;
  time: number;
  senderId: number;
  senderName: string;
  text: string;
  /** 图片段引用（OneBot 的 file 或 url），供 OCR 使用 */
  images?: string[];
  /** 语音段引用，供转写使用 */
  voices?: string[];
}

/** 从消息段里取出语音引用（record/voice，优先 file，其次 url） */
export function voiceRefs(message: unknown): string[] {
  if (!Array.isArray(message)) return [];
  const out: string[] = [];
  for (const seg of message as any[]) {
    if (seg?.type !== 'record' && seg?.type !== 'voice') continue;
    const ref = seg?.data?.file || seg?.data?.url || seg?.data?.path;
    if (typeof ref === 'string' && ref !== '') out.push(ref);
  }
  return out;
}

/** 从消息段里取出图片引用（优先 file，其次 url） */
export function imageRefs(message: unknown): string[] {
  if (!Array.isArray(message)) return [];
  const out: string[] = [];
  for (const seg of message as any[]) {
    if (seg?.type !== 'image') continue;
    const ref = seg?.data?.file || seg?.data?.url;
    if (typeof ref === 'string' && ref !== '') out.push(ref);
  }
  return out;
}

/** OneBot 消息段 → 纯文本 */
export function flattenMessage(message: unknown): string {
  if (typeof message === 'string') return message;
  if (!Array.isArray(message)) return '';
  return message
    .map((seg: any) => {
      switch (seg?.type) {
        case 'text': return seg.data?.text ?? '';
        case 'image': return '[图片]';
        case 'face': return '[表情]';
        case 'mface': return '[表情包]';
        case 'at': return `@${seg.data?.qq === 'all' ? '全体成员' : seg.data?.qq}`;
        case 'record': return '[语音]';
        case 'video': return '[视频]';
        case 'file': return '[文件]';
        case 'reply': return '[回复]';
        case 'json':
        case 'xml': return '[卡片]';
        case 'forward': return '[合并转发]';
        default: return `[${seg?.type ?? '未知'}]`;
      }
    })
    .join('')
    .trim();
}

interface HistoryClient {
  getGroupMsgHistory(
    groupId: number,
    messageSeq?: number,
    count?: number,
    reverseOrder?: boolean,
  ): Promise<{ messages: any[] }>;
}

export interface FetchOptions {
  limit?: number;
  /** 只要这个时间点（秒）之后的消息 */
  cutoff?: number;
}

/**
 * 向前翻页拉取群历史，按 message_id 去重，按时间升序返回。
 * 最多翻 60 页，防止接口异常时死循环。
 */
export async function fetchGroupMessages(
  client: HistoryClient,
  groupId: number,
  options: FetchOptions = {},
): Promise<FlatMessage[]> {
  const limit = Math.min(Math.max(options.limit ?? 500, 1), 5000);
  const cutoff = options.cutoff ?? 0;
  const byId = new Map<string, FlatMessage>();

  let seq: number | undefined;
  let guard = 0;
  let noProgress = 0;

  while (byId.size < limit && guard < 60) {
    guard += 1;
    const beforeSize = byId.size;
    // 第二次起必须 reverseOrder，否则 NapCat 无视 message_seq、把最新页重复返回，
    // 循环里全是重复消息 → byId 不再增长 → 停在第一页（这就是"只有 100 条"的由来）
    const batch = await client.getGroupMsgHistory(
      groupId,
      seq,
      Math.min(100, Math.max(1, limit - byId.size)),
      seq !== undefined,
    );
    const messages = batch?.messages ?? [];
    if (messages.length === 0) break;
    const freshSeqs: number[] = [];

    for (const m of messages) {
      if (cutoff && m.time < cutoff) continue;
      const key = String(m.message_id ?? `${m.time}:${m.message_seq}`);
      if (byId.has(key)) continue;
      if (typeof m.message_seq === 'number') freshSeqs.push(m.message_seq);
      byId.set(key, {
        id: key,
        groupId,
        time: m.time,
        senderId: m.sender?.user_id ?? m.user_id,
        senderName: (m.sender as any)?.card || (m.sender as any)?.nickname || String(m.sender?.user_id ?? m.user_id),
        text: flattenMessage(m.message),
        ...(imageRefs(m.message).length ? { images: imageRefs(m.message) } : {}),
        ...(voiceRefs(m.message).length ? { voices: voiceRefs(m.message) } : {}),
      });
    }

    const oldest = messages.reduce((a, b) => (a.message_seq <= b.message_seq ? a : b));
    // ⚠️ 不要用 `oldest.message_seq === seq` 当终止条件。
    // 实测 NapCat 的窗口语义不是"严格早于 seq"：它会给一段围绕 seq 的区间，
    // 于是连着两页的 oldestSeq 可能相同，但**再翻一页仍然会往前挪**。
    // 早先按 seq 不变就 break，结果 711 条只拿到 280 条就停了。
    // 正确的进度判据是"这一页有没有带来新消息"。
    const grew = byId.size > beforeSize;
    if (!grew) {
      noProgress += 1;
      if (noProgress >= 2) break;
    } else {
      noProgress = 0;
    }
    // 下一页的锚点要取"本页**新增**消息里最早的那条 seq"。
    // 用整页最早的 seq 不行：NapCat 返回的窗口会包含大量本页之前已经见过的消息，
    // 拿重复消息的 seq 去请下一页，它会再给你同一个窗口 —— 于是永远停在原地。
    seq = freshSeqs.length ? Math.min(...freshSeqs) : oldest.message_seq;
    if (cutoff && oldest.time < cutoff) break;
  }

  return [...byId.values()].sort((a, b) => a.time - b.time);
}

/** 把 "7d" / "24h" / "90m" 解析成秒；纯数字按天 */
export function parseDuration(input: string | undefined): number | undefined {
  if (!input) return undefined;
  const m = String(input).trim().match(/^(\d+(?:\.\d+)?)\s*([smhdw]?)$/i);
  if (!m) return undefined;
  const n = Number(m[1]);
  const unit = (m[2] || 'd').toLowerCase();
  const mult: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 };
  return Math.floor(n * (mult[unit] ?? 86400));
}
