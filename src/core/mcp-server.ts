/**
 * 极简 MCP server（stdio，newline-delimited JSON-RPC 2.0）。
 *
 * 目的：让 Claude Code / Cursor 等 MCP 客户端直接查询本地 QQ 数据。
 * 只实现最小可用集合：initialize / tools/list / tools/call / ping。
 *
 * 与具体数据源解耦：通过 McpBackend 注入，便于单测。
 */

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface SendArgs {
  kind: 'private' | 'group';
  target: number;
  text: string;
}

export interface McpBackend {
  search(args: { query: string; groupId?: number; limit?: number; since?: number }): Promise<unknown>;
  digest(args: { groupId: number; limit?: number; days?: number }): Promise<unknown>;
  listGroups(): Promise<unknown>;
  /** 真正发送；只在两阶段确认通过后被调用 */
  send(args: SendArgs): Promise<unknown>;
  /** 选一张表情：给 intent 让 Jev/关键词挑，或直接指定 stickerId */
  pickSticker(args: { intent?: string; stickerId?: string }): Promise<{ id: string; label: string; source: string }>;
  /** 召回长期记忆（只读） */
  recallMemory(args: { scope?: string; keyword?: string; limit?: number }): Promise<unknown>;
  /** 写入长期记忆（默认禁用，见 McpOptions.allowMemoryWrite） */
  rememberMemory(args: { text: string; scope?: string; weight?: number }): Promise<unknown>;
  /** 真正发送表情 */
  sendSticker(args: { kind: 'private' | 'group'; target: number; stickerId: string; label: string; remoteUrl?: string }): Promise<unknown>;
}

/** 群发开关：默认关闭，只能在进程内显式打开（MCP 场景不给模型这个能力） */
export interface McpOptions {
  allowGroupSend?: boolean;
  /** 允许模型写长期记忆。默认关闭：记忆会长期进入上下文，等于可持久化投毒 */
  allowMemoryWrite?: boolean;
  /** 确认令牌有效期（毫秒） */
  tokenTtlMs?: number;
}

interface PendingSend {
  args: SendArgs;
  summary: string;
  expiresAt: number;
}

/** 待确认的发送请求（内存态，进程退出即失效） */
const pending = new Map<string, PendingSend>();

/** 表情确认令牌 → 已选定的表情 */
const pendingStickers = new Map<string, { id: string; label: string; source: string }>();

/** 仅供测试：清空待确认队列 */
export function __clearPending(): void {
  pending.clear();
  pendingStickers.clear();
}
let tokenSeq = 0;

function makeToken(): string {
  tokenSeq += 1;
  return `ctk_${Date.now().toString(36)}_${tokenSeq}`;
}

export interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

export const TOOLS: McpTool[] = [
  {
    name: 'search_messages',
    description: '在本地 QQ 聊天记录里按关键词搜索消息，返回时间、发送者与上下文片段。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '关键词（中文或英文）' },
        groupId: { type: 'number', description: '只搜某个群（可选）' },
        limit: { type: 'number', description: '返回条数上限，默认 20' },
        since: { type: 'number', description: '起始 Unix 时间戳（秒），可选' },
      },
      required: ['query'],
    },
  },
  {
    name: 'group_digest',
    description: '生成某个群一段时间的日报：消息量、活跃成员、值得回看的消息。',
    inputSchema: {
      type: 'object',
      properties: {
        groupId: { type: 'number', description: '群号' },
        limit: { type: 'number', description: '拉取消息条数，默认 500' },
        days: { type: 'number', description: '只看最近 N 天（可选）' },
      },
      required: ['groupId'],
    },
  },
  {
    name: 'list_groups',
    description: '列出当前账号加入的群（群号、名称、人数）。',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'recall_memory',
    description: '召回长期记忆（越久越淡，按权重排序）。只读。',
    inputSchema: {
      type: 'object',
      properties: {
        scope: { type: 'string', description: '范围，如群号或 QQ 号' },
        keyword: { type: 'string', description: '按关键词过滤（可选）' },
        limit: { type: 'number', description: '条数，默认 5' },
      },
    },
  },
  {
    name: 'remember_memory',
    description: '写一条长期记忆。默认在服务端禁用（记忆会长期进入上下文，可能被用来做持久化提示词注入）。',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '要记住的内容' },
        scope: { type: 'string', description: '归属范围，默认 global' },
        weight: { type: 'number', description: '重要度 0-1，默认 0.7' },
      },
      required: ['text'],
    },
  },
  {
    name: 'send_sticker',
    description: '给指定 QQ 或群发表情包。可以给 intent（由 Jev 决策模型从表情库里挑一张），也可以直接给 stickerId。同样是两阶段确认；群发默认禁用。',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['private', 'group'], description: 'private=私聊（默认），group=群聊' },
        target: { type: 'number', description: 'QQ 号或群号' },
        intent: { type: 'string', description: '想表达的意思，例如「安慰一下」「无语」「庆祝」' },
        stickerId: { type: 'string', description: '指定表情 id（64 位 hash）；给了就跳过选择' },
        confirmationToken: { type: 'string', description: '第一阶段返回的 ctk_xxx' },
      },
      required: ['target'],
    },
  },
  {
    name: 'send_message',
    description: '给指定 QQ 或群发消息。两阶段确认：第一次只返回确认令牌与摘要，带上 confirmationToken 再调一次才真正发送。群发默认禁用。',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['private', 'group'], description: 'private=私聊（默认），group=群聊' },
        target: { type: 'number', description: 'QQ 号或群号' },
        text: { type: 'string', description: '消息内容（纯文本）' },
        confirmationToken: { type: 'string', description: '第一阶段返回的 ctk_xxx；带上它才会真正发送' },
      },
      required: ['target', 'text'],
    },
  },
];

function ok(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

function fail(id: string | number | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

/**
 * 处理一条 JSON-RPC 消息。
 * 通知（无 id）返回 null，调用方不应回包。
 */
export async function handleMessage(
  backend: McpBackend,
  message: JsonRpcRequest,
  options: McpOptions = {},
): Promise<JsonRpcResponse | null> {
  const id = message.id ?? null;
  const method = message.method ?? '';

  if (method.startsWith('notifications/')) return null;

  switch (method) {
    case 'initialize':
      return ok(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'qchat-cli', version: '0.25.0' },
      });

    case 'ping':
      return ok(id, {});

    case 'tools/list':
      return ok(id, { tools: TOOLS });

    case 'tools/call': {
      const params = message.params ?? {};
      const name = String(params.name ?? '');
      const args = (params.arguments ?? {}) as Record<string, unknown>;

      try {
        switch (name) {
          case 'search_messages': {
            const query = String(args.query ?? '').trim();
            if (!query) return ok(id, { content: [{ type: 'text', text: '缺少参数 query' }], isError: true });
            const data = await backend.search({
              query,
              groupId: typeof args.groupId === 'number' ? args.groupId : undefined,
              limit: typeof args.limit === 'number' ? args.limit : undefined,
              since: typeof args.since === 'number' ? args.since : undefined,
            });
            return ok(id, { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
          }
          case 'group_digest': {
            const groupId = Number(args.groupId);
            if (!Number.isFinite(groupId) || groupId <= 0) {
              return ok(id, { content: [{ type: 'text', text: '缺少参数 groupId' }], isError: true });
            }
            const data = await backend.digest({
              groupId,
              limit: typeof args.limit === 'number' ? args.limit : undefined,
              days: typeof args.days === 'number' ? args.days : undefined,
            });
            return ok(id, { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
          }
          case 'list_groups': {
            const data = await backend.listGroups();
            return ok(id, { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
          }
          case 'recall_memory': {
            const data = await backend.recallMemory({
              ...(typeof args.scope === 'string' ? { scope: args.scope } : {}),
              ...(typeof args.keyword === 'string' ? { keyword: args.keyword } : {}),
              ...(typeof args.limit === 'number' ? { limit: args.limit } : {}),
            });
            return ok(id, { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
          }

          case 'remember_memory': {
            if (options.allowMemoryWrite !== true) {
              return ok(id, {
                content: [{ type: 'text', text: '记忆写入已在服务端禁用（需要显式打开 MCP_ALLOW_MEMORY_WRITE=1）' }],
                isError: true,
              });
            }
            const text = String(args.text ?? '').trim();
            if (text === '') return ok(id, { content: [{ type: 'text', text: 'text 不能为空' }], isError: true });
            if (text.length > 500) return ok(id, { content: [{ type: 'text', text: 'text 超过 500 字上限' }], isError: true });
            const data = await backend.rememberMemory({
              text,
              ...(typeof args.scope === 'string' ? { scope: args.scope } : {}),
              ...(typeof args.weight === 'number' ? { weight: args.weight } : {}),
            });
            return ok(id, { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
          }

          case 'send_sticker': {
            const kind: 'private' | 'group' = args.kind === 'group' ? 'group' : 'private';
            const target = Number(args.target);
            const intent = typeof args.intent === 'string' ? args.intent.trim() : '';
            const explicitId = typeof args.stickerId === 'string' ? args.stickerId.trim() : '';
            if (!Number.isFinite(target) || target <= 0) {
              return ok(id, { content: [{ type: 'text', text: 'target 需要是 QQ 号或群号' }], isError: true });
            }
            if (intent === '' && explicitId === '') {
              return ok(id, { content: [{ type: 'text', text: '需要给 intent 或 stickerId' }], isError: true });
            }
            if (kind === 'group' && options.allowGroupSend !== true) {
              return ok(id, {
                content: [{ type: 'text', text: '群发已在服务端禁用（需要显式打开 MCP_ALLOW_GROUP_SEND=1）' }],
                isError: true,
              });
            }

            const token = typeof args.confirmationToken === 'string' ? args.confirmationToken : '';
            const where = kind === 'group' ? '群' : 'QQ';

            if (token === '') {
              // 第一阶段就把"选哪一张"定下来，摘要里让人看到具体表情
              let picked: { id: string; label: string; source: string };
              try {
                picked = await backend.pickSticker({ ...(intent ? { intent } : {}), ...(explicitId ? { stickerId: explicitId } : {}) });
              } catch (error) {
                return ok(id, {
                  content: [{ type: 'text', text: `挑表情失败：${(error as Error)?.message ?? error}` }],
                  isError: true,
                });
              }
              const ctk = makeToken();
              const srcNote = (picked as any).remoteUrl ? 'memecub 在线' : picked.source;
              const summary = `将发到${where} ${target}：表情「${picked.label}」（${srcNote}，id ${String(picked.id).slice(0, 12)}…）`;
              pending.set(ctk, {
                args: { kind, target, text: `sticker:${picked.id}` },
                summary,
                expiresAt: Date.now() + (options.tokenTtlMs ?? 300_000),
              });
              pendingStickers.set(ctk, picked);
              return ok(id, {
                content: [{
                  type: 'text',
                  text: `待确认：${summary}
确认后再调用一次，并带上这个令牌：
confirmation_token: ${ctk}
（5 分钟内有效）`,
                }],
              });
            }

            const entry = pending.get(token);
            const sticker = pendingStickers.get(token);
            if (!entry || !sticker || entry.expiresAt < Date.now()) {
              pending.delete(token);
              pendingStickers.delete(token);
              return ok(id, { content: [{ type: 'text', text: '确认令牌无效或已过期，请重新发起' }], isError: true });
            }
            pending.delete(token);
            pendingStickers.delete(token);
            const sent = await backend.sendSticker({
              kind, target, stickerId: sticker.id, label: sticker.label,
              ...((sticker as any).remoteUrl ? { remoteUrl: (sticker as any).remoteUrl } : {}),
            });
            return ok(id, { content: [{ type: 'text', text: JSON.stringify(sent ?? { ok: true }, null, 2) }] });
          }

          case 'send_message': {
            const kind: 'private' | 'group' = args.kind === 'group' ? 'group' : 'private';
            const target = Number(args.target);
            const text = String(args.text ?? '').trim();
            if (!Number.isFinite(target) || target <= 0) {
              return ok(id, { content: [{ type: 'text', text: 'target 需要是 QQ 号或群号' }], isError: true });
            }
            if (text === '') {
              return ok(id, { content: [{ type: 'text', text: 'text 不能为空' }], isError: true });
            }
            if (kind === 'group' && options.allowGroupSend !== true) {
              return ok(id, {
                content: [{ type: 'text', text: '群发已在服务端禁用（需要显式打开 MCP_ALLOW_GROUP_SEND=1）' }],
                isError: true,
              });
            }

            const token = typeof args.confirmationToken === 'string' ? args.confirmationToken : '';
            const where = kind === 'group' ? '群' : 'QQ';

            if (token === '') {
              // 第一阶段：只登记，不发。模型必须把摘要交给人确认后再次调用。
              const ctk = makeToken();
              const summary = `将发送到${where} ${target}：${text.slice(0, 80)}${text.length > 80 ? '…' : ''}`;
              pending.set(ctk, {
                args: { kind, target, text },
                summary,
                expiresAt: Date.now() + (options.tokenTtlMs ?? 300_000),
              });
              return ok(id, {
                content: [{
                  type: 'text',
                  text: `待确认：${summary}
确认后再调用一次，并带上这个令牌：
confirmation_token: ${ctk}
（5 分钟内有效）`,
                }],
              });
            }

            const entry = pending.get(token);
            if (!entry || entry.expiresAt < Date.now()) {
              pending.delete(token);
              return ok(id, { content: [{ type: 'text', text: '确认令牌无效或已过期，请重新发起' }], isError: true });
            }
            if (entry.args.kind !== kind || entry.args.target !== target || entry.args.text !== text) {
              return ok(id, { content: [{ type: 'text', text: '确认令牌与本次发送内容不匹配' }], isError: true });
            }
            pending.delete(token);
            const sent = await backend.send(entry.args);
            return ok(id, { content: [{ type: 'text', text: JSON.stringify(sent ?? { ok: true }, null, 2) }] });
          }
          default:
            return fail(id, -32602, `unknown tool: ${name}`);
        }
      } catch (error) {
        return ok(id, {
          content: [{ type: 'text', text: `工具执行失败: ${(error as Error)?.message ?? error}` }],
          isError: true,
        });
      }
    }

    default:
      return fail(id, -32601, `method not found: ${method}`);
  }
}

/**
 * stdio 事件循环：逐行读 JSON、回写响应。
 * 任何解析错误都回 -32700 并且不中断循环。
 */
export function runStdioServer(
  backend: McpBackend,
  io: { stdin: NodeJS.ReadableStream; stdout: NodeJS.WritableStream },
  options: McpOptions = {},
): void {
  let buffer = '';

  io.stdin.setEncoding('utf8');
  io.stdin.on('data', (chunk: string) => {
    buffer += chunk;
    let index = buffer.indexOf('\n');
    while (index >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      index = buffer.indexOf('\n');
      if (line === '') continue;

      let parsed: JsonRpcRequest;
      try {
        parsed = JSON.parse(line);
      } catch {
        io.stdout.write(`${JSON.stringify(fail(null, -32700, 'parse error'))}\n`);
        continue;
      }

      void handleMessage(backend, parsed, options)
        .then((response) => {
          if (response) io.stdout.write(`${JSON.stringify(response)}\n`);
        })
        .catch((error) => {
          io.stdout.write(`${JSON.stringify(fail(parsed.id ?? null, -32603, String(error?.message ?? error)))}\n`);
        });
    }
  });
}
