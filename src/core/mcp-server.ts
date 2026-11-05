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

export interface McpBackend {
  search(args: { query: string; groupId?: number; limit?: number; since?: number }): Promise<unknown>;
  digest(args: { groupId: number; limit?: number; days?: number }): Promise<unknown>;
  listGroups(): Promise<unknown>;
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
export async function handleMessage(backend: McpBackend, message: JsonRpcRequest): Promise<JsonRpcResponse | null> {
  const id = message.id ?? null;
  const method = message.method ?? '';

  if (method.startsWith('notifications/')) return null;

  switch (method) {
    case 'initialize':
      return ok(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'qchat-cli', version: '0.5.0' },
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
export function runStdioServer(backend: McpBackend, io: { stdin: NodeJS.ReadableStream; stdout: NodeJS.WritableStream }): void {
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

      void handleMessage(backend, parsed)
        .then((response) => {
          if (response) io.stdout.write(`${JSON.stringify(response)}\n`);
        })
        .catch((error) => {
          io.stdout.write(`${JSON.stringify(fail(parsed.id ?? null, -32603, String(error?.message ?? error)))}\n`);
        });
    }
  });
}
