/**
 * memecub MCP 表情源。
 *
 * 它是个 Streamable HTTP MCP server（要求 Accept 带 text/event-stream），
 * 只有一个有用工具：search_memes(query, limit) —— 返回图片 URL 列表。
 *
 * 注意：索引以**英文**为主（facepalm / cat 有结果，中文"无语"返回 0），
 * 所以中文意图要先翻成英文关键词再查。
 */

export const MEMECUB_ENDPOINT = 'https://memecub.com/mcp';

export interface MemeResult {
  title: string;
  url: string;
  /** 是否允许商用（memecub 每条都给） */
  commercialUse?: boolean;
  credit?: string;
}

export interface MemeSearchOptions {
  limit?: number;
  endpoint?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/** 从 MCP tools/call 的返回里取 JSON 结果 */
export function parseMemeToolResult(payload: unknown): MemeResult[] {
  const content = (payload as any)?.result?.content;
  if (!Array.isArray(content)) return [];
  const textPart = content.find((c: any) => c?.type === 'text' && typeof c?.text === 'string');
  if (!textPart) return [];
  let parsed: any;
  try {
    parsed = JSON.parse(textPart.text);
  } catch {
    return [];
  }
  const list = Array.isArray(parsed?.results) ? parsed.results : [];
  return list
    .map((r: any): MemeResult | null => {
      const url = r?.image_url ?? r?.url ?? r?.image ?? '';
      if (typeof url !== 'string' || url === '') return null;
      return {
        title: String(r?.title ?? r?.name ?? ''),
        url,
        ...(typeof r?.commercial_use === 'boolean' ? { commercialUse: r.commercial_use } : {}),
        ...(typeof r?.credit === 'string' ? { credit: r.credit } : {}),
      };
    })
    .filter((x: MemeResult | null): x is MemeResult => x !== null);
}

/** 搜表情：失败返回空数组（调用方决定提示） */
export async function searchMemes(query: string, options: MemeSearchOptions = {}): Promise<MemeResult[]> {
  const q = String(query ?? '').trim();
  if (q === '') return [];

  const endpoint = options.endpoint ?? process.env.QCE_MEMECUB_URL ?? MEMECUB_ENDPOINT;
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Streamable HTTP MCP 必须声明接受 SSE，否则服务端直接 406
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/call',
        params: { name: 'search_memes', arguments: { query: q, limit: Math.min(Math.max(options.limit ?? 8, 1), 20) } },
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
    });
    if (!res.ok) return [];
    return parseMemeToolResult(await res.json());
  } catch {
    return [];
  }
}
