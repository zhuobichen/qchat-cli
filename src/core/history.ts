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
  getGroupMsgHistory(groupId: number, messageSeq?: number, count?: number): Promise<{ messages: any[] }>;
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

  while (byId.size < limit && guard < 60) {
    guard += 1;
    const batch = await client.getGroupMsgHistory(groupId, seq, Math.min(100, Math.max(1, limit - byId.size)));
    const messages = batch?.messages ?? [];
    if (messages.length === 0) break;

    for (const m of messages) {
      if (cutoff && m.time < cutoff) continue;
      const key = String(m.message_id ?? `${m.time}:${m.message_seq}`);
      if (byId.has(key)) continue;
      byId.set(key, {
        id: key,
        groupId,
        time: m.time,
        senderId: m.sender?.user_id ?? m.user_id,
        senderName: (m.sender as any)?.card || (m.sender as any)?.nickname || String(m.sender?.user_id ?? m.user_id),
        text: flattenMessage(m.message),
      });
    }

    const oldest = messages.reduce((a, b) => (a.message_seq <= b.message_seq ? a : b));
    if (oldest.message_seq === seq) break;
    seq = oldest.message_seq;
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
