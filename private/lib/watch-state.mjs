/**
 * watcher 的持久化状态：原子写入 + 崩溃安全 + 断点续传。
 *
 * 为什么不用普通 writeFileSync：
 *   断电/强杀时写到一半，JSON 会损坏 → 重启读不出来 → 水位归零 → 消息重投或漏投。
 *   原子写（先写 .tmp 再 rename）在 Windows 和 POSIX 上都不会留下半个文件。
 *
 * 断点续传的关键：水位按「会话」分开存（p<QQ> / g<群号>），
 * 每个会话记住上次处理到的时间戳和最后一条消息 id，重启后从那儿继续。
 *
 * 注意：这是 .mjs（纯 JS），不写 TS 语法。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';

export function emptyState() {
  return {
    version: 2,
    cursors: {},
    seen: {},
    pending: [],
    lastDigestAt: 0,
    stats: { polls: 0, delivered: 0, failed: 0, restarts: 0 },
  };
}

/** 读状态；损坏时备份坏文件并返回空状态（不静默丢数据） */
export function loadState(path) {
  if (!existsSync(path)) return { state: emptyState() };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    // v1 兼容：把 lastTime 平移到 cursors
    if (!parsed.version) {
      const cursors = {};
      for (const [k, v] of Object.entries(parsed.lastTime ?? {})) {
        cursors[k] = { lastTime: Number(v) || 0 };
      }
      return {
        state: {
          ...emptyState(),
          cursors,
          seen: parsed.seen ?? {},
          pending: parsed.pending ?? [],
          lastDigestAt: parsed.lastDigestAt ?? 0,
        },
      };
    }
    return {
      state: {
        ...emptyState(),
        ...parsed,
        cursors: parsed.cursors ?? {},
        seen: parsed.seen ?? {},
        pending: parsed.pending ?? [],
        stats: parsed.stats ?? { polls: 0, delivered: 0, failed: 0, restarts: 0 },
      },
    };
  } catch {
    // 状态文件坏了：改名备份，重新开始（而不是让整个 watcher 起不来）
    try {
      renameSync(path, `${path}.corrupt-${Date.now()}`);
      return { state: emptyState(), recoveredFrom: path };
    } catch {
      return { state: emptyState() };
    }
  }
}

/**
 * 原子写：先写临时文件，再 rename。
 * rename 在同一分区是原子的，所以读到的永远是完整 JSON。
 */
export function saveStateAtomic(path, state) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    // seen 只保留最近 5000 条，避免文件无限膨胀
    const ids = Object.keys(state.seen);
    if (ids.length > 5000) for (const id of ids.slice(0, ids.length - 5000)) delete state.seen[id];

    const tmp = `${path}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify(state), 'utf8');
    renameSync(tmp, path);
  } catch {
    /* 写不进去也不能让 watcher 挂掉 */
  }
}

/** 推进某会话的水位 */
export function advanceCursor(state, key, time, messageId) {
  const cur = state.cursors[key] ?? { lastTime: 0 };
  // 只前进，不后退（避免乱序消息把水位拉回去导致重复投递）
  if (time >= cur.lastTime) {
    cur.lastTime = time;
    if (messageId !== undefined && messageId > (cur.lastMessageId ?? 0)) {
      cur.lastMessageId = messageId;
    }
  }
  cur.lastSeenAt = Math.floor(Date.now() / 1000);
  state.cursors[key] = cur;
}

/** 判断消息是否已经处理过（比水位新的才算） */
export function isNewMessage(state, key, time, messageId) {
  const cur = state.cursors[key];
  if (!cur) return true;
  if (time > cur.lastTime) return true;
  if (time < cur.lastTime) return false;
  // 同一秒：靠 message id 区分
  if (messageId !== undefined && cur.lastMessageId !== undefined) {
    return messageId > cur.lastMessageId;
  }
  return false;
}

/** 汇总状态（给 --status 看） */
export function summarize(state) {
  return {
    sessions: Object.keys(state.cursors).length,
    pending: state.pending.length,
    ...(state.lastRunAt ? { lastRunAt: new Date(state.lastRunAt).toISOString() } : {}),
    ...state.stats,
  };
}
