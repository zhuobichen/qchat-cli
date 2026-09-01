import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { MessageSegment, OneBotEvent } from './onebot-client.js';

interface ContextMessage {
  id: number;
  time: number;
  userId: number;
  sender: string;
  content: string;
  images: ImageReference[];
}

export interface ImageReference {
  messageId: number;
  index: number;
  file: string;
}

interface StoredPrivateContext {
  version: 1;
  updatedAt: string;
  messages: ContextMessage[];
  pendingCompaction: ContextMessage[];
}

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CONTEXT_DIR = resolve(PROJECT_ROOT, 'private/context');
const MAX_HISTORY_MESSAGES = 100;
const MAX_PENDING_MESSAGES = 120;

export function privateContextPath(userId: number): string {
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error('Invalid user id');
  return resolve(CONTEXT_DIR, `private-${userId}.json`);
}

export function sharedPrivateContextPath(): string {
  return resolve(CONTEXT_DIR, 'private-shared.json');
}

function contentFromSegments(messageId: number, segments: MessageSegment[]): { content: string; images: ImageReference[] } {
  const parts: string[] = [];
  const images: ImageReference[] = [];
  for (const segment of segments) {
    if (segment.type === 'text' && 'text' in segment.data) parts.push(segment.data.text);
    else if (segment.type === 'image') {
      const index = images.length + 1;
      images.push({ messageId, index, file: segment.data.file });
      parts.push(`[图片 message=${messageId} image=${index}]`);
    } else if (segment.type === 'face') parts.push('[表情]');
  }
  return { content: parts.join('').replace(/\0/g, '').trim(), images };
}

export class PrivateContextStore {
  private readonly messages = new Map<number, ContextMessage[]>();
  private readonly pendingCompaction = new Map<number, ContextMessage[]>();
  private readonly sharedMessages: ContextMessage[] = [];
  private readonly sharedPendingCompaction: ContextMessage[] = [];
  private readonly seenIds = new Set<number>();

  constructor(private readonly storagePath?: string) {
    this.load();
  }

  record(event: OneBotEvent): ContextMessage | null {
    if (event.post_type !== 'message' || event.message_type !== 'private' || !Array.isArray(event.message)) return null;
    if (this.seenIds.has(event.message_id)) return null;

    const parsed = contentFromSegments(event.message_id, event.message as MessageSegment[]);
    const message: ContextMessage = {
      id: event.message_id,
      time: event.time || Math.floor(Date.now() / 1000),
      userId: event.user_id,
      sender: event.sender.nickname || String(event.user_id),
      content: parsed.content,
      images: parsed.images,
    };
    this.seenIds.add(message.id);
    if (this.seenIds.size > 2_000) this.seenIds.delete(this.seenIds.values().next().value!);

    const history = this.messages.get(event.user_id) || [];
    history.push(message);
    if (history.length > MAX_HISTORY_MESSAGES) history.splice(0, history.length - MAX_HISTORY_MESSAGES);
    this.messages.set(event.user_id, history);
    this.appendPending(event.user_id, message);
    this.appendShared(message);
    this.save();
    return message;
  }

  recordOutgoing(userId: number, messageId: number, content: string): void {
    const message: ContextMessage = {
      id: messageId,
      time: Math.floor(Date.now() / 1000),
      userId,
      sender: '机器人',
      content: content.replace(/\0/g, '').trim(),
      images: [],
    };
    const history = this.messages.get(userId) || [];
    history.push(message);
    if (history.length > MAX_HISTORY_MESSAGES) history.splice(0, history.length - MAX_HISTORY_MESSAGES);
    this.messages.set(userId, history);
    this.appendPending(userId, message);
    this.appendShared(message);
    this.save();
  }

  buildAgentInput(userId: number, limit: number, maxChars: number): string {
    const content = this.format((this.messages.get(userId) || []).slice(-limit));
    return content.length > maxChars ? content.slice(-maxChars) : content;
  }

  buildSharedAgentInput(limit: number, maxChars: number): string {
    const content = this.format(this.sharedMessages.slice(-limit), true);
    return content.length > maxChars ? content.slice(-maxChars) : content;
  }

  findImage(userId: number, messageId: number, index: number): ImageReference | null {
    const message = (this.messages.get(userId) || []).find((item) => item.id === messageId);
    return message?.images.find((image) => image.index === index) || null;
  }

  needsCompaction(userId: number, threshold: number): boolean {
    return (this.pendingCompaction.get(userId)?.length || 0) >= threshold;
  }

  buildCompactionInput(userId: number, maxMessages: number = 80): { content: string; count: number } {
    const messages = (this.pendingCompaction.get(userId) || []).slice(0, maxMessages);
    return { content: this.format(messages), count: messages.length };
  }

  markCompacted(userId: number, count: number): void {
    const pending = this.pendingCompaction.get(userId) || [];
    pending.splice(0, Math.max(0, count));
    this.pendingCompaction.set(userId, pending);
    this.save();
  }

  needsSharedCompaction(threshold: number): boolean {
    return this.sharedPendingCompaction.length >= threshold;
  }

  buildSharedCompactionInput(maxMessages: number = 80): { content: string; count: number } {
    const messages = this.sharedPendingCompaction.slice(0, maxMessages);
    return { content: this.format(messages, true), count: messages.length };
  }

  markSharedCompacted(count: number): void {
    this.sharedPendingCompaction.splice(0, Math.max(0, count));
    this.save();
  }

  private appendPending(userId: number, message: ContextMessage): void {
    const pending = this.pendingCompaction.get(userId) || [];
    pending.push(message);
    if (pending.length > MAX_PENDING_MESSAGES) pending.splice(0, pending.length - MAX_PENDING_MESSAGES);
    this.pendingCompaction.set(userId, pending);
  }

  private appendShared(message: ContextMessage): void {
    this.sharedMessages.push(message);
    if (this.sharedMessages.length > MAX_HISTORY_MESSAGES) {
      this.sharedMessages.splice(0, this.sharedMessages.length - MAX_HISTORY_MESSAGES);
    }
    this.sharedPendingCompaction.push(message);
    if (this.sharedPendingCompaction.length > MAX_PENDING_MESSAGES) {
      this.sharedPendingCompaction.splice(0, this.sharedPendingCompaction.length - MAX_PENDING_MESSAGES);
    }
  }

  private load(): void {
    if (!this.storagePath || !existsSync(this.storagePath)) return;
    try {
      const raw = JSON.parse(readFileSync(this.storagePath, 'utf-8')) as Partial<StoredPrivateContext>;
      const messages = this.sanitizeMessages(raw.messages, MAX_HISTORY_MESSAGES);
      const pending = this.sanitizeMessages(raw.pendingCompaction, MAX_PENDING_MESSAGES);
      for (const message of messages) {
        const history = this.messages.get(message.userId) || [];
        history.push(message);
        this.messages.set(message.userId, history);
        this.seenIds.add(message.id);
      }
      for (const message of pending) {
        const items = this.pendingCompaction.get(message.userId) || [];
        items.push(message);
        this.pendingCompaction.set(message.userId, items);
      }
      this.sharedMessages.push(...messages);
      this.sharedPendingCompaction.push(...pending);
    } catch {
      // Treat corrupt or incompatible local state as an empty context.
    }
  }

  private save(): void {
    if (!this.storagePath) return;
    const record: StoredPrivateContext = {
      version: 1,
      updatedAt: new Date().toISOString(),
      messages: this.sharedMessages.slice(-MAX_HISTORY_MESSAGES),
      pendingCompaction: this.sharedPendingCompaction.slice(-MAX_PENDING_MESSAGES),
    };
    const directory = dirname(this.storagePath);
    if (!existsSync(directory)) mkdirSync(directory, { recursive: true, mode: 0o700 });
    const tempPath = `${this.storagePath}.${process.pid}.tmp`;
    writeFileSync(tempPath, JSON.stringify(record, null, 2), { encoding: 'utf-8', mode: 0o600 });
    renameSync(tempPath, this.storagePath);
    try { chmodSync(this.storagePath, 0o600); } catch {}
  }

  private sanitizeMessages(value: unknown, maxMessages: number): ContextMessage[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item): ContextMessage[] => {
      if (!item || typeof item !== 'object') return [];
      const candidate = item as Partial<ContextMessage>;
      if (
        typeof candidate.id !== 'number' ||
        !Number.isSafeInteger(candidate.id) ||
        typeof candidate.time !== 'number' ||
        !Number.isFinite(candidate.time) ||
        typeof candidate.userId !== 'number' ||
        !Number.isSafeInteger(candidate.userId) ||
        candidate.userId <= 0 ||
        typeof candidate.sender !== 'string' ||
        typeof candidate.content !== 'string'
      ) return [];
      const images = Array.isArray(candidate.images)
        ? candidate.images.flatMap((image): ImageReference[] => {
          if (
            !image ||
            typeof image !== 'object' ||
            typeof (image as Partial<ImageReference>).messageId !== 'number' ||
            !Number.isSafeInteger((image as Partial<ImageReference>).messageId) ||
            typeof (image as Partial<ImageReference>).index !== 'number' ||
            !Number.isSafeInteger((image as Partial<ImageReference>).index) ||
            typeof (image as Partial<ImageReference>).file !== 'string'
          ) return [];
          return [{
            messageId: (image as ImageReference).messageId,
            index: (image as ImageReference).index,
            file: (image as ImageReference).file,
          }];
        })
        : [];
      return [{
        id: candidate.id,
        time: candidate.time,
        userId: candidate.userId,
        sender: candidate.sender.slice(0, 200),
        content: candidate.content.replace(/\0/g, '').slice(0, 20_000),
        images,
      }];
    }).slice(-maxMessages);
  }

  private format(messages: ContextMessage[], includeUserId: boolean = false): string {
    return messages.map((message) => {
      const time = new Date(message.time * 1000).toLocaleTimeString('zh-CN');
      const sender = includeUserId ? `QQ ${message.userId} ${message.sender}` : message.sender;
      return `[${time}] ${sender}: ${message.content || '[非文本消息]'}`;
    }).join('\n');
  }
}
