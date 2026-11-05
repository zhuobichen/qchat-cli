/**
 * 本地消息索引（增量、去重、可重建）。
 *
 * 为什么需要：每次搜索都从 OneBot 重拉历史，既慢又受限于服务端缓存。
 * 这里把拉到的消息落到本机 JSONL，按 group 分文件、按 id 去重，
 * 之后搜索/日报/MCP 都读本地，毫秒级返回。
 *
 * 不依赖网络，路径由调用方注入，便于单测。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface StoredMessage {
  id: string;
  groupId: number;
  time: number;
  senderId: number;
  senderName: string;
  text: string;
  images?: string[];
}

/** 默认索引目录：~/.qchat-cli/index（可用 QCE_INDEX_DIR 覆盖） */
export function defaultIndexRoot(): string {
  return process.env.QCE_INDEX_DIR || join(homedir(), '.qchat-cli', 'index');
}

const FILE_RE = /^group-(-?\d+)\.jsonl$/;

export class MessageStore {
  root: string;

  constructor(root: string = defaultIndexRoot()) {
    try {
      mkdirSync(root, { recursive: true });
      this.root = root;
    } catch {
      // 主目录不可写（受限账户 / 沙箱 / 只读挂载）时退到工作目录
      const fallback = join(process.cwd(), '.qce-index');
      mkdirSync(fallback, { recursive: true });
      this.root = fallback;
    }
  }

  private fileFor(groupId: number): string {
    return join(this.root, `group-${groupId}.jsonl`);
  }

  /** 读某个群的全部消息（已去重、按时间升序） */
  load(groupId: number): StoredMessage[] {
    const file = this.fileFor(groupId);
    if (!existsSync(file)) return [];
    const byId = new Map<string, StoredMessage>();
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (trimmed === '') continue;
      try {
        const m = JSON.parse(trimmed) as StoredMessage;
        if (m && typeof m.id === 'string') byId.set(m.id, m);
      } catch {
        // 坏行跳过，不让一行脏数据毁掉整个索引
      }
    }
    return [...byId.values()].sort((a, b) => a.time - b.time);
  }

  /** 读全部群的消息 */
  loadAll(): StoredMessage[] {
    const all: StoredMessage[] = [];
    for (const { groupId } of this.stats()) all.push(...this.load(groupId));
    return all.sort((a, b) => a.time - b.time);
  }

  /**
   * 增量合并：只追加 store 里没有的 id。
   * @returns 新增条数与合并后总数
   */
  merge(groupId: number, incoming: StoredMessage[]): { added: number; total: number } {
    const existing = this.load(groupId);
    const seen = new Set(existing.map((m) => m.id));
    const fresh: StoredMessage[] = [];
    for (const m of incoming) {
      if (!m || typeof m.id !== 'string' || seen.has(m.id)) continue;
      seen.add(m.id);
      fresh.push(m);
    }
    if (fresh.length > 0) {
      const lines = fresh.map((m) => JSON.stringify(m)).join('\n') + '\n';
      appendFileSync(this.fileFor(groupId), lines, 'utf8');
    }
    return { added: fresh.length, total: existing.length + fresh.length };
  }

  /** 该群已索引消息的最新时间戳（秒），空索引返回 0 */
  watermark(groupId: number): number {
    const msgs = this.load(groupId);
    return msgs.length ? msgs[msgs.length - 1].time : 0;
  }

  /** 各群索引概览 */
  stats(): { groupId: number; count: number; newest: number }[] {
    if (!existsSync(this.root)) return [];
    const out: { groupId: number; count: number; newest: number }[] = [];
    for (const name of readdirSync(this.root)) {
      const m = name.match(FILE_RE);
      if (!m) continue;
      const groupId = Number(m[1]);
      const msgs = this.load(groupId);
      out.push({ groupId, count: msgs.length, newest: msgs.length ? msgs[msgs.length - 1].time : 0 });
    }
    return out.filter((s) => s.count > 0).sort((a, b) => b.newest - a.newest);
  }

  /** 清空某个群；不传则全部清空 */
  clear(groupId?: number): void {
    if (groupId !== undefined) {
      const file = this.fileFor(groupId);
      if (existsSync(file)) unlinkSync(file);
      return;
    }
    // 逐群删文件，而不是 rm -rf 整个目录：删目录在部分沙箱/只读挂载上会静默失败
    for (const s of this.stats()) {
      const file = this.fileFor(s.groupId);
      if (existsSync(file)) unlinkSync(file);
    }
  }
}
