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
  /**
   * 海克斯大乱斗战绩：按 RiotID 查某人最近的对局。
   * 返回 { card: 可直接贴进群的文本, candidate, overview? }。
   */
  hexPlayerStats(args: { player: string; games?: number; raw?: boolean }): Promise<unknown>;
  /** 搜同名玩家，用于消歧（只给名字时会有多个候选） */
  hexSearchPlayer(args: { name: string }): Promise<unknown>;
  /** 查某个海克斯强化的效果（名字模糊匹配） */
  hexAugment(args: { q: string }): Promise<unknown>;
  /**
   * 列出最近满足「开黑」条件的对局（只读）。
   * 条件来自 private/hex-roster.json：anchor 在场 + 至少 minOthers 名成员。
   */
  hexTeamReport(args: { depth?: number }): Promise<unknown>;
  /** 真正发出某一局的开黑播报（两阶段确认通过后才调用） */
  hexAnnounceNow(args: { gameId: number }): Promise<unknown>;

  // ── 工具层的五个动作（2026-11-12 补）──
  /** 发一张本地图片或远程图片（同样两阶段确认 + 白名单） */
  sendImage(args: { kind: 'private' | 'group'; target: number; path?: string; url?: string }): Promise<unknown>;
  /** 戳一戳：群里戳某人，或私聊戳对方 */
  poke(args: { kind: 'private' | 'group'; target: number; userId?: number }): Promise<unknown>;
  /** 用 MiniMax 生图，返回落盘路径 */
  draw(args: { prompt: string; aspectRatio?: string; count?: number }): Promise<unknown>;
  /** 把活派给子会话（车道），返回会话 id 与车道名 */
  dispatch(args: { task: string; lane?: string }): Promise<unknown>;
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

/** 开黑播报确认令牌 → 待播的那一局 */
const pendingHex = new Map<string, { gameId: number; text: string; expiresAt: number }>();

/** 仅供测试：清空待确认队列 */
export function __clearPending(): void {
  pending.clear();
  pendingStickers.clear();
  pendingHex.clear();
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
    name: 'hex_player_stats',
    description:
      '查某人的英雄联盟「海克斯大乱斗」战绩：胜率、KDA、综合实力分、最近几局用了什么英雄和哪些海克斯强化。数据来自第三方站点 hex.hexsss.com 的公开接口。需要 RiotID，形如 名字#1234。',
    inputSchema: {
      type: 'object',
      properties: {
        player: { type: 'string', description: 'RiotID，必须带 #TAG，例如 Faker#0520' },
        games: { type: 'number', description: '列出最近几局，默认 3，最多 10' },
        raw: { type: 'boolean', description: 'true 时附带完整原始 JSON（默认只给卡片文本）' },
      },
      required: ['player'],
    },
  },
  {
    name: 'hex_search_player',
    description: '按名字搜海克斯大乱斗玩家，返回候选（RiotID + 大区 + 等级），用于确认要查哪一个。',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '角色名（可只给名字不带 #TAG）' },
      },
      required: ['name'],
    },
  },
  {
    name: 'hex_augment',
    description: '查海克斯大乱斗某个强化符文的效果。名字可以模糊匹配，例如「牙仙子」「珠光」。数据来自本地缓存的完整强化表。',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: '强化名或其中一部分' },
      },
      required: ['q'],
    },
  },
  {
    name: 'hex_team_report',
    description:
      '列出群里最近「一起开黑」的海克斯大乱斗对局：同一局里有指定锚点玩家，且还有至少 N 名名单成员。只读，不发消息。',
    inputSchema: {
      type: 'object',
      properties: {
        depth: { type: 'number', description: '每人往前看几局，默认 8' },
      },
    },
  },
  {
    name: 'hex_announce',
    description:
      '把某一局开黑播报发到群里。两阶段：先不带令牌调用拿预览，确认后再带 confirmationToken 调用才真正发送。',
    inputSchema: {
      type: 'object',
      properties: {
        gameId: { type: 'number', description: '要播报的对局 id（来自 hex_team_report）；省略则取最新一局' },
        confirmationToken: { type: 'string', description: '第一阶段返回的令牌；带上才会真发' },
      },
    },
  },
  {
    name: 'send_image',
    description:
      '发一张图片（本地路径或 http(s) 链接）到指定 QQ 或群。两阶段确认：第一次返回令牌与摘要，带上 confirmationToken 才真正发送；群发默认禁用。',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', description: 'private 或 group，默认 private' },
        target: { type: 'number', description: 'QQ 号或群号' },
        path: { type: 'string', description: '本地图片路径（与 url 二选一）' },
        url: { type: 'string', description: '远程图片地址（与 path 二选一）' },
        confirmationToken: { type: 'string', description: '第一阶段返回的令牌；带上才会真发' },
      },
      required: ['target'],
    },
  },
  {
    name: 'poke',
    description: '戳一戳。私聊戳对方（target=QQ 号）；群里戳某人（kind=group、target=群号、userId=被戳的人）。',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', description: 'private 或 group，默认 private' },
        target: { type: 'number', description: 'QQ 号或群号' },
        userId: { type: 'number', description: '群聊时被戳的人' },
      },
      required: ['target'],
    },
  },
  {
    name: 'draw',
    description: '用 MiniMax image-01 生成图片，返回落盘路径（默认 16:9）。',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: '画面描述' },
        aspectRatio: { type: 'string', description: '宽高比，如 16:9 / 1:1 / 9:16，默认 16:9' },
        count: { type: 'number', description: '张数 1-4，默认 1' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'dispatch',
    description: '把一件写代码/做分析的活派给独立会话（车道）去干，避免污染当前上下文。返回会话 id。',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: '要它干什么，写清楚' },
        lane: { type: 'string', description: '车道名：cli / software / data，默认 cli' },
      },
      required: ['task'],
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
        serverInfo: { name: 'qchat-cli', version: '0.37.0' },
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

          case 'hex_player_stats': {
            const player = String(args.player ?? '').trim();
            if (player === '') {
              return ok(id, { content: [{ type: 'text', text: '缺少参数 player（形如 名字#1234）' }], isError: true });
            }
            const games = typeof args.games === 'number' ? Math.min(10, Math.max(1, Math.floor(args.games))) : 3;
            try {
              const res = (await backend.hexPlayerStats({ player, games, raw: args.raw === true })) as { card?: string };
              const text = res?.card ?? JSON.stringify(res, null, 2);
              return ok(id, { content: [{ type: 'text', text }] });
            } catch (error) {
              return ok(id, {
                content: [{ type: 'text', text: `查战绩失败：${(error as Error)?.message ?? error}` }],
                isError: true,
              });
            }
          }

          case 'hex_search_player': {
            const name = String(args.name ?? '').trim();
            if (name === '') {
              return ok(id, { content: [{ type: 'text', text: '缺少参数 name' }], isError: true });
            }
            const data = await backend.hexSearchPlayer({ name });
            return ok(id, { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
          }

          case 'hex_augment': {
            const q = String(args.q ?? '').trim();
            if (q === '') {
              return ok(id, { content: [{ type: 'text', text: '缺少参数 q' }], isError: true });
            }
            const data = (await backend.hexAugment({ q })) as Array<{ name?: string; level?: string; desc?: string }>;
            if (!Array.isArray(data) || data.length === 0) {
              return ok(id, { content: [{ type: 'text', text: `没找到「${q}」这个强化` }] });
            }
            const text = data
              .map((a) => `【${a.name ?? '?'}】${a.level ?? ''}\n  ${a.desc ?? '(无描述)'}`)
              .join('\n\n');
            return ok(id, { content: [{ type: 'text', text }] });
          }

          case 'hex_team_report': {
            const depth = typeof args.depth === 'number' ? Math.min(20, Math.max(3, Math.floor(args.depth))) : 8;
            try {
              const data = (await backend.hexTeamReport({ depth })) as {
                teams?: Array<{ gameId: number; card: string }>;
              };
              const teams = data?.teams ?? [];
              if (teams.length === 0) {
                return ok(id, { content: [{ type: 'text', text: '最近没有满足条件的开黑局' }] });
              }
              const text = teams
                .map((t) => `gameId=${t.gameId}\n${t.card}`)
                .join('\n\n---\n\n');
              return ok(id, { content: [{ type: 'text', text }] });
            } catch (error) {
              return ok(id, {
                content: [{ type: 'text', text: `查开黑失败：${(error as Error)?.message ?? error}` }],
                isError: true,
              });
            }
          }

          case 'hex_announce': {
            const token = typeof args.confirmationToken === 'string' ? args.confirmationToken : '';
            const wantId = typeof args.gameId === 'number' ? Math.floor(args.gameId) : undefined;

            if (token === '') {
              // 第一阶段：找局、渲染、登记，不发
              let report;
              try {
                report = (await backend.hexTeamReport({ depth: 8 })) as {
                  teams?: Array<{ gameId: number; card: string }>;
                };
              } catch (error) {
                return ok(id, {
                  content: [{ type: 'text', text: `查开黑失败：${(error as Error)?.message ?? error}` }],
                  isError: true,
                });
              }
              const teams = report?.teams ?? [];
              const target = wantId ? teams.find((t) => t.gameId === wantId) : teams[0];
              if (!target) {
                return ok(id, {
                  content: [{ type: 'text', text: wantId ? `没有 gameId=${wantId} 的开黑局` : '最近没有可播报的开黑局' }],
                });
              }
              const ctk = makeToken();
              pendingHex.set(ctk, {
                gameId: target.gameId,
                text: target.card,
                expiresAt: Date.now() + (options.tokenTtlMs ?? 300_000),
              });
              return ok(id, {
                content: [{
                  type: 'text',
                  text: `待确认：将播报 gameId=${target.gameId}

${target.card}

确认后再调用一次 hex_announce，带上：
confirmationToken: ${ctk}
（5 分钟内有效）`,
                }],
              });
            }

            const entry = pendingHex.get(token);
            if (!entry) {
              return ok(id, {
                content: [{ type: 'text', text: '令牌无效或已过期，请重新走一次预览' }],
                isError: true,
              });
            }
            if (Date.now() > entry.expiresAt) {
              pendingHex.delete(token);
              return ok(id, { content: [{ type: 'text', text: '令牌已过期，请重新走一次预览' }], isError: true });
            }
            if (options.allowGroupSend !== true) {
              return ok(id, {
                content: [{ type: 'text', text: '群发已在服务端禁用（需要显式打开 MCP_ALLOW_GROUP_SEND=1）' }],
                isError: true,
              });
            }
            try {
              const res = await backend.hexAnnounceNow({ gameId: entry.gameId });
              pendingHex.delete(token);
              return ok(id, {
                content: [{ type: 'text', text: `已播报 gameId=${entry.gameId}\n${JSON.stringify(res)}` }],
              });
            } catch (error) {
              return ok(id, {
                content: [{ type: 'text', text: `播报失败：${(error as Error)?.message ?? error}` }],
                isError: true,
              });
            }
          }

          case 'send_image': {
            const kind: 'private' | 'group' = args.kind === 'group' ? 'group' : 'private';
            const target = Number(args.target);
            const imgPath = typeof args.path === 'string' ? args.path.trim() : '';
            const imgUrl = typeof args.url === 'string' ? args.url.trim() : '';
            if (!Number.isFinite(target) || target <= 0) {
              return ok(id, { content: [{ type: 'text', text: 'target 需要是 QQ 号或群号' }], isError: true });
            }
            if (!imgPath && !imgUrl) {
              return ok(id, { content: [{ type: 'text', text: 'path 和 url 至少给一个' }], isError: true });
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
              const ctk = makeToken();
              const what = imgPath || imgUrl;
              const summary = `将把图片发到${where} ${target}：${what.slice(0, 80)}`;
              pending.set(ctk, {
                args: { kind, target, text: `image:${what}` },
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
            pending.delete(token);
            try {
              const sent = await backend.sendImage({
                kind, target,
                ...(imgPath ? { path: imgPath } : {}),
                ...(imgUrl ? { url: imgUrl } : {}),
              });
              return ok(id, { content: [{ type: 'text', text: JSON.stringify(sent ?? { ok: true }, null, 2) }] });
            } catch (error) {
              return ok(id, {
                content: [{ type: 'text', text: `发送失败：${(error as Error)?.message ?? error}` }],
                isError: true,
              });
            }
          }

          case 'poke': {
            const kind: 'private' | 'group' = args.kind === 'group' ? 'group' : 'private';
            const target = Number(args.target);
            const userId = args.userId === undefined ? undefined : Number(args.userId);
            if (!Number.isFinite(target) || target <= 0) {
              return ok(id, { content: [{ type: 'text', text: 'target 需要是 QQ 号或群号' }], isError: true });
            }
            if (kind === 'group' && (!userId || !Number.isFinite(userId))) {
              return ok(id, { content: [{ type: 'text', text: '群聊要带 userId（戳谁）' }], isError: true });
            }
            try {
              const r = await backend.poke({ kind, target, ...(userId ? { userId } : {}) });
              return ok(id, { content: [{ type: 'text', text: JSON.stringify(r ?? { ok: true }, null, 2) }] });
            } catch (error) {
              return ok(id, {
                content: [{ type: 'text', text: `戳失败：${(error as Error)?.message ?? error}` }],
                isError: true,
              });
            }
          }

          case 'draw': {
            const prompt = String(args.prompt ?? '').trim();
            if (!prompt) return ok(id, { content: [{ type: 'text', text: 'prompt 不能为空' }], isError: true });
            try {
              const r = await backend.draw({
                prompt,
                ...(typeof args.aspectRatio === 'string' ? { aspectRatio: args.aspectRatio } : {}),
                ...(typeof args.count === 'number' ? { count: args.count } : {}),
              });
              return ok(id, { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] });
            } catch (error) {
              return ok(id, {
                content: [{ type: 'text', text: `生图失败：${(error as Error)?.message ?? error}` }],
                isError: true,
              });
            }
          }

          case 'dispatch': {
            const task = String(args.task ?? '').trim();
            if (!task) return ok(id, { content: [{ type: 'text', text: 'task 不能为空' }], isError: true });
            try {
              const r = await backend.dispatch({
                task,
                ...(typeof args.lane === 'string' ? { lane: args.lane } : {}),
              });
              return ok(id, { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] });
            } catch (error) {
              return ok(id, {
                content: [{ type: 'text', text: `派活失败：${(error as Error)?.message ?? error}` }],
                isError: true,
              });
            }
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
