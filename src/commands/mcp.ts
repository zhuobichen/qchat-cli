import { Command } from 'commander';
import { authManager } from '../core/auth.js';
import { runStdioServer, type McpBackend } from '../core/mcp-server.js';
import { fetchGroupMessages } from '../core/history.js';
import { searchDocs } from '../core/search-index.js';
import { buildDigest } from '../core/digest.js';

/**
 * 把 OneBot 客户端包装成 MCP backend。
 * 每个工具都只做只读查询，不发送、不修改任何东西。
 */
function makeBackend(): McpBackend {
  const client = authManager.getClient();
  return {
    async search({ query, groupId, limit, since }) {
      const scan = 1000;
      const docs = groupId
        ? await fetchGroupMessages(client, groupId, { limit: scan, cutoff: since ?? 0 })
        : [];
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
      const digest = buildDigest(
        messages.map((m) => ({ time: m.time, senderId: m.senderId, senderName: m.senderName, text: m.text })),
        { title: `群 ${groupId} 日报` },
      );
      return digest;
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
      runStdioServer(makeBackend(), { stdin: process.stdin, stdout: process.stdout });
    });
}
