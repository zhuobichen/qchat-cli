import { MessageSegment, OneBotEvent } from './onebot-client.js';

interface ContextMessage {
  id: number;
  time: number;
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
    }
    else if (segment.type === 'face') parts.push('[表情]');
    else if (segment.type === 'at') parts.push('[提及]');
  }
  return { content: parts.join('').replace(/\0/g, '').trim(), images };
}

export class GroupContextStore {
  private readonly messages = new Map<number, ContextMessage[]>();
  private readonly pendingCompaction = new Map<number, ContextMessage[]>();
  private readonly seenIds = new Set<number>();

  record(event: OneBotEvent): ContextMessage | null {
    if (event.post_type !== 'message' || event.message_type !== 'group' || !Array.isArray(event.message)) return null;
    if (this.seenIds.has(event.message_id)) return null;

    const parsed = contentFromSegments(event.message_id, event.message as MessageSegment[]);
    const message: ContextMessage = {
      id: event.message_id,
      time: event.time || Math.floor(Date.now() / 1000),
      sender: event.sender.card || event.sender.nickname || String(event.user_id),
      content: parsed.content,
      images: parsed.images,
    };
    this.seenIds.add(message.id);
    if (this.seenIds.size > 2_000) this.seenIds.delete(this.seenIds.values().next().value!);

    const history = this.messages.get(event.group_id) || [];
    history.push(message);
    if (history.length > 100) history.splice(0, history.length - 100);
    this.messages.set(event.group_id, history);
    this.appendPending(event.group_id, message);
    return message;
  }

  recordOutgoing(groupId: number, messageId: number, content: string): void {
    const message: ContextMessage = {
      id: messageId,
      time: Math.floor(Date.now() / 1000),
      sender: '机器人',
      content: content.replace(/\0/g, '').trim(),
      images: [],
    };
    const history = this.messages.get(groupId) || [];
    history.push(message);
    if (history.length > 100) history.splice(0, history.length - 100);
    this.messages.set(groupId, history);
    this.appendPending(groupId, message);
  }

  buildAgentInput(groupId: number, limit: number, maxChars: number): string {
    const history = (this.messages.get(groupId) || []).slice(-limit);
    const content = this.format(history);
    return content.length > maxChars ? content.slice(-maxChars) : content;
  }

  findImage(groupId: number, messageId: number, index: number): ImageReference | null {
    const message = (this.messages.get(groupId) || []).find((item) => item.id === messageId);
    return message?.images.find((image) => image.index === index) || null;
  }

  needsCompaction(groupId: number, threshold: number): boolean {
    return (this.pendingCompaction.get(groupId)?.length || 0) >= threshold;
  }

  buildCompactionInput(groupId: number, maxMessages: number = 80): { content: string; count: number } {
    const messages = (this.pendingCompaction.get(groupId) || []).slice(0, maxMessages);
    return { content: this.format(messages), count: messages.length };
  }

  markCompacted(groupId: number, count: number): void {
    const pending = this.pendingCompaction.get(groupId) || [];
    pending.splice(0, Math.max(0, count));
    this.pendingCompaction.set(groupId, pending);
  }

  private appendPending(groupId: number, message: ContextMessage): void {
    const pending = this.pendingCompaction.get(groupId) || [];
    pending.push(message);
    if (pending.length > 120) pending.splice(0, pending.length - 120);
    this.pendingCompaction.set(groupId, pending);
  }

  private format(messages: ContextMessage[]): string {
    return messages.map((message) => {
      const time = new Date(message.time * 1000).toLocaleTimeString('zh-CN');
      return `[${time}] ${message.sender}: ${message.content || '[非文本消息]'}`;
    }).join('\n');
  }
}
