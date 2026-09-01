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
    if (history.length > 100) history.splice(0, history.length - 100);
    this.messages.set(event.user_id, history);
    this.appendPending(event.user_id, message);
    this.appendShared(message);
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
    if (history.length > 100) history.splice(0, history.length - 100);
    this.messages.set(userId, history);
    this.appendPending(userId, message);
    this.appendShared(message);
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
  }

  private appendPending(userId: number, message: ContextMessage): void {
    const pending = this.pendingCompaction.get(userId) || [];
    pending.push(message);
    if (pending.length > 120) pending.splice(0, pending.length - 120);
    this.pendingCompaction.set(userId, pending);
  }

  private appendShared(message: ContextMessage): void {
    this.sharedMessages.push(message);
    if (this.sharedMessages.length > 100) this.sharedMessages.splice(0, this.sharedMessages.length - 100);
    this.sharedPendingCompaction.push(message);
    if (this.sharedPendingCompaction.length > 120) {
      this.sharedPendingCompaction.splice(0, this.sharedPendingCompaction.length - 120);
    }
  }

  private format(messages: ContextMessage[], includeUserId: boolean = false): string {
    return messages.map((message) => {
      const time = new Date(message.time * 1000).toLocaleTimeString('zh-CN');
      const sender = includeUserId ? `QQ ${message.userId} ${message.sender}` : message.sender;
      return `[${time}] ${sender}: ${message.content || '[非文本消息]'}`;
    }).join('\n');
  }
}
