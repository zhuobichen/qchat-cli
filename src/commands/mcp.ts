import { Command } from 'commander';
import { authManager } from '../core/auth.js';
import { runStdioServer, type McpBackend } from '../core/mcp-server.js';
import { fetchGroupMessages } from '../core/history.js';
import { searchDocs } from '../core/search-index.js';
import { buildDigest } from '../core/digest.js';
import { MessageStore, defaultIndexRoot } from '../core/message-store.js';
import { safetyManager } from '../core/safety.js';

/**
 * 把 OneBot 客户端包装成 MCP backend。
 * 每个工具都只做只读查询，不发送、不修改任何东西。
 * 搜索优先读本地索引；索引为空时按需拉一次并落盘。
 */
function makeBackend(): McpBackend {
  const client = authManager.getClient();
  const store = new MessageStore(defaultIndexRoot());

  return {
    async search({ query, groupId, limit, since }) {
      const cutoff = since ?? 0;

      if (groupId !== undefined && store.load(groupId).length === 0) {
        const messages = await fetchGroupMessages(client, groupId, { limit: 1000, cutoff });
        store.merge(groupId, messages);
      }

      const docs = groupId !== undefined ? store.load(groupId) : store.loadAll();
      const hits = searchDocs(docs, query, { groupId, limit: limit ?? 20, since });
      return hits.map((h) => ({
        time: new Date(h.time * 1000).toISOString(),
        groupId: h.groupId,
        sender: h.senderName,
        senderId: h.senderId,
        score: Number(h.score.toFixed(3)),
        snippet: h.snippet,
      }));
    },

    async digest({ groupId, limit, days }) {
      const cutoff = days ? Math.floor(Date.now() / 1000) - days * 86400 : 0;
      const messages = await fetchGroupMessages(client, groupId, { limit: limit ?? 500, cutoff });
      // 顺带把拉到的消息并入索引，后续搜索更快
      store.merge(groupId, messages);
      const digest = buildDigest(
        messages.map((m) => ({ time: m.time, senderId: m.senderId, senderName: m.senderName, text: m.text })),
        { title: `群 ${groupId} 日报` },
      );
      return digest;
    },

    async send({ kind, target, text }) {
      // 发送前必须过安全检查：未被授权的会话一律拒绝
      if (!safetyManager.isAllowed(target)) {
        throw new Error(`会话 ${target} 未授权发送（先跑 qce safety allow ${target}）`);
      }
      if (kind === 'group') {
        await client.sendGroupMessage(target, text);
        return { ok: true, kind, target, sentAt: new Date().toISOString() };
      }
      await client.sendPrivateMessage(target, text);
      return { ok: true, kind, target, sentAt: new Date().toISOString() };
    },

    async listGroups() {
      const groups: any[] = (await client.getGroupList()) as any[];
      return (Array.isArray(groups) ? groups : []).map((g: any) => ({
        groupId: g.group_id,
        name: g.group_name,
        members: g.member_count,
      }));
    },
  };
}

export function mcpCommand(program: Command): void {
  program
    .command('mcp')
    .description('以 MCP server 方式运行（stdio），供 Claude Code / Cursor 调用：search_messages / group_digest / list_groups')
    .action(() => {
      if (!authManager.isConfigured()) {
        // MCP 客户端看不到 stdout 之外的日志，错误必须写 stderr
        console.error('qce mcp: 尚未配置 NapCatQQ 连接，请先运行 qce login --host <host> --port <port>');
        process.exit(1);
      }
      // stdout 只能出现 JSON-RPC，日志一律走 stderr
      console.error('qce mcp: ready (stdio)');
      const allowGroupSend = process.env.MCP_ALLOW_GROUP_SEND === '1';
      if (!allowGroupSend) console.error('qce mcp: 群发已禁用（MCP_ALLOW_GROUP_SEND=1 可打开）');
      runStdioServer(makeBackend(), { stdin: process.stdin, stdout: process.stdout }, { allowGroupSend });
    });
}
