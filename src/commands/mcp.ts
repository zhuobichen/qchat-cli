import { Command } from 'commander';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { authManager } from '../core/auth.js';
import { runStdioServer, type McpBackend } from '../core/mcp-server.js';
import { fetchGroupMessages } from '../core/history.js';
import { searchDocs } from '../core/search-index.js';
import { buildDigest } from '../core/digest.js';
import { MessageStore, defaultIndexRoot } from '../core/message-store.js';
import { safetyManager } from '../core/safety.js';
import { pickStickerMerged, stickerFile } from '../core/sticker.js';
import { MemoryStore, recallMemories, filterByKeyword } from '../core/memory.js';
import { hexSearch, pickCandidate, hexOverview, hexAugments, findAugment, renderHexCard } from '../core/hex-api.js';
import { loadRoster, findTeamGames, renderTeamBroadcast, type HexRoster } from '../core/hex-team.js';

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

    async recallMemory({ scope, keyword, limit }) {
      const store = new MemoryStore(defaultIndexRoot());
      const all = store.load();
      const filtered = keyword ? filterByKeyword(all, keyword) : all;
      return recallMemories(filtered, { ...(scope ? { scope } : {}), limit: limit ?? 5 });
    },

    async rememberMemory({ text, scope, weight }) {
      const store = new MemoryStore(defaultIndexRoot());
      const now = Math.floor(Date.now() / 1000);
      const { record, added } = store.remember({
        scope: scope ?? 'global',
        text,
        createdAt: now,
        weight: Math.min(1, Math.max(0, weight ?? 0.7)),
      });
      return { id: record.id, added };
    },

    async pickSticker({ intent, stickerId }) {
      if (stickerId) {
        const path = stickerFile(stickerId);
        if (!path) throw new Error(`表情 ${stickerId} 不存在`);
        return { id: stickerId, label: '(指定)', source: 'explicit' };
      }
      // 本地库 + memecub 的候选一起交给 Jev 横向比较
      const picked = await pickStickerMerged(String(intent ?? ''));
      if (!picked) throw new Error('表情库和 memecub 都没有匹配的候选');
      if (picked.origin === 'memecub' && picked.remoteUrl) {
        return {
          id: picked.id,
          label: picked.label,
          source: 'memecub',
          remoteUrl: picked.remoteUrl,
        };
      }
      if (!stickerFile(picked.id)) throw new Error(`表情文件缺失：${picked.id}`);
      return { id: picked.id, label: picked.label, source: picked.source };
    },

    async sendSticker({ kind, target, stickerId, remoteUrl }) {
      if (!safetyManager.isAllowed(target)) {
        throw new Error(`会话 ${target} 未授权发送（先跑 qce safety allow ${target}）`);
      }

      let path: string | null = null;
      if (remoteUrl) {
        // memecub 的图：下载到临时目录再发
        // 别写用户目录（低权限进程会 EPERM）；放项目内的 output/memes
        const dir = join(process.cwd(), 'output', 'memes');
        mkdirSync(dir, { recursive: true });
        const res = await fetch(String(remoteUrl), { signal: AbortSignal.timeout(30_000) });
        if (!res.ok) throw new Error(`下载表情失败 HTTP ${res.status}`);
        const ctype = String(res.headers.get('content-type') ?? '');
        const ext = ctype.includes('png') ? 'png'
          : ctype.includes('gif') ? 'gif'
          : ctype.includes('webp') ? 'webp' : 'jpg';
        path = join(dir, `meme-${Date.now()}.${ext}`);
        writeFileSync(path, Buffer.from(await res.arrayBuffer()));
      } else {
        path = stickerFile(String(stickerId));
        if (!path) throw new Error(`表情文件不存在：${stickerId}`);
      }

      const message = [{ type: 'image', data: { file: path } }] as any;
      if (kind === 'group') await client.sendGroupMessage(target, message);
      else await client.sendPrivateMessage(target, message);
      return {
        ok: true, kind, target, stickerId,
        ...(remoteUrl ? { source: 'memecub', remoteUrl } : {}),
        sentAt: new Date().toISOString(),
      };
    },

    // ── 工具层的五个动作 ─────────────────────────────────
    async sendImage({ kind, target, path: imgPath, url }) {
      if (!safetyManager.isAllowed(target)) {
        throw new Error(`会话 ${target} 未授权发送（先跑 qce safety allow ${target}）`);
      }
      let file = imgPath ?? '';
      if (url) {
        // 远程图先落到 output/memes，别写用户目录（低权限进程会 EPERM）
        const dir = join(process.cwd(), 'output', 'memes');
        mkdirSync(dir, { recursive: true });
        const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
        if (!res.ok) throw new Error(`下载图片失败 HTTP ${res.status}`);
        const ctype = String(res.headers.get('content-type') ?? '');
        const ext = ctype.includes('png') ? 'png' : ctype.includes('gif') ? 'gif' : ctype.includes('webp') ? 'webp' : 'jpg';
        file = join(dir, `img-${Date.now()}.${ext}`);
        writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      }
      if (!file) throw new Error('path 和 url 至少给一个');
      const message = [{ type: 'image', data: { file } }] as any;
      if (kind === 'group') await client.sendGroupMessage(target, message);
      else await client.sendPrivateMessage(target, message);
      return { ok: true, kind, target, file, sentAt: new Date().toISOString() };
    },

    async poke({ kind, target, userId }) {
      if (!safetyManager.isAllowed(target)) {
        throw new Error(`会话 ${target} 未授权（先跑 qce safety allow ${target}）`);
      }
      if (kind === 'group') {
        if (!userId) throw new Error('群聊要带 userId');
        await client.call('group_poke', { group_id: target, user_id: userId });
        return { ok: true, kind, groupId: target, userId };
      }
      await client.call('friend_poke', { user_id: target });
      return { ok: true, kind, target };
    },

    async draw({ prompt, aspectRatio, count }) {
      const args = [join(ROOT, 'scripts', 'minimax-image.mjs'), prompt, '--ar', aspectRatio ?? '16:9', '--n', String(count ?? 1)];
      const r = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 240_000 });
      const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
      if (r.status !== 0) throw new Error(out.trim().slice(-300) || '生图失败');
      const paths = out.split('\n').filter((l) => l.startsWith('IMAGE_PATH=')).map((l) => l.slice('IMAGE_PATH='.length).trim());
      if (!paths.length) throw new Error('生图没有返回路径');
      return { ok: true, images: paths, model: 'image-01', aspectRatio: aspectRatio ?? '16:9' };
    },

    async dispatch({ task, lane }) {
      const args = [join(ROOT, 'scripts', 'dispatch.mjs'), 'new', task, '--lane', lane ?? 'cli'];
      const r = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 60_000 });
      const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
      if (r.status !== 0) throw new Error(out.slice(-300) || '派活失败');
      const id = (out.match(/session-[0-9a-f-]{8,}/i) ?? [])[0] ?? '';
      return { ok: true, lane: lane ?? 'cli', sessionId: id, output: out.split('\n').slice(-4).join('\n') };
    },

    async listGroups() {
      const groups: any[] = (await client.getGroupList()) as any[];
      return (Array.isArray(groups) ? groups : []).map((g: any) => ({
        groupId: g.group_id,
        name: g.group_name,
        members: g.member_count,
      }));
    },

    // ── 海克斯大乱斗（第三方 hex.hexsss.com 的公开接口，只读）───────────────
    async hexPlayerStats({ player, games, raw }) {
      const list = await hexSearch(player);
      if (list.length === 0) {
        return { card: `没找到「${player}」。要带 #TAG 一起，比如 名字#1234` };
      }
      const cand = pickCandidate(list, player);
      if (!cand) return { card: `「${player}」没有可用候选` };

      const ov = await hexOverview(cand.puuid, cand.sgpServerId, Math.max(10, games ?? 3));
      const card = renderHexCard(cand, ov, games ?? 3);

      if (raw) {
        return { card, candidate: cand, overview: ov, otherCandidates: list.length - 1 };
      }
      return { card, ...(list.length > 1 ? { note: `另有 ${list.length - 1} 个同名候选，可用 hex_search_player 查看` } : {}) };
    },

    async hexSearchPlayer({ name }) {
      const list = await hexSearch(name);
      return list.slice(0, 10).map((c) => ({
        riotId: `${c.gameName}#${c.tagLine}`,
        server: String(c.sgpServerId ?? '').replace('TENCENT_', ''),
        level: c.summonerLevel ?? null,
      }));
    },

    async hexAugment({ q }) {
      const items = await hexAugments(hexAugmentCachePath());
      return findAugment(items, q);
    },

    async hexTeamReport({ depth }) {
      const roster = loadHexRoster();
      const games = await findTeamGames(roster, { depth: depth ?? 8 });
      return {
        teams: games.map((g) => ({
          gameId: g.gameId,
          creation: g.creation,
          win: g.win,
          members: g.results.map((r) => ({ qq: r.qq, name: r.qqName, champion: r.champion })),
          card: renderTeamBroadcast(g),
        })),
      };
    },

    async hexAnnounceNow({ gameId }) {
      const roster = loadHexRoster();
      const games = await findTeamGames(roster, { depth: 8 });
      const g = games.find((x) => x.gameId === gameId);
      if (!g) throw new Error(`没有 gameId=${gameId} 的开黑局（可能已超出时间窗）`);
      if (!safetyManager.isAllowed(roster.group)) {
        throw new Error(`群 ${roster.group} 未授权发送（先跑 qce safety allow ${roster.group}）`);
      }
      const text = renderTeamBroadcast(g);
      await client.sendGroupMessage(roster.group, text);
      return { ok: true, group: roster.group, gameId, members: g.results.length, win: g.win };
    },
  };
}

/** 名单位置：跟强化表缓存放一起，都在索引目录 */
function hexRosterPath(): string {
  return join(defaultIndexRoot(), 'hex-roster.json');
}

function hexAugmentCachePath(): string {
  return join(defaultIndexRoot(), 'hex-augments.json');
}

/**
 * 读名单。优先用索引目录里那份（可回写 puuid），
 * 没有就退回项目里的 private/hex-roster.json。
 */
function loadHexRoster(): HexRoster {
  const candidates = [hexRosterPath(), join(process.cwd(), 'private', 'hex-roster.json')];
  for (const p of candidates) {
    try {
      return loadRoster(p);
    } catch {
      /* 试下一个 */
    }
  }
  throw new Error('找不到 hex-roster.json（名单文件）');
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function mcpCommand(program: Command): void {
  program
    .command('mcp')
    .description(
      '以 MCP server 方式运行（stdio），供 Claude Code / Cursor 调用：search_messages / group_digest / list_groups / recall_memory / send_sticker / hex_player_stats / hex_search_player / hex_augment',
    )
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
      const allowMemoryWrite = process.env.MCP_ALLOW_MEMORY_WRITE === '1';
      if (!allowMemoryWrite) console.error('qce mcp: 记忆写入已禁用（MCP_ALLOW_MEMORY_WRITE=1 可打开）');
      runStdioServer(makeBackend(), { stdin: process.stdin, stdout: process.stdout }, { allowGroupSend, allowMemoryWrite });
    });
}
