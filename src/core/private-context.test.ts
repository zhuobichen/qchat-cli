import { describe, expect, it } from 'vitest';
import { PrivateContextStore } from './private-context.js';

function event(messageId: number, text: string) {
  return {
    post_type: 'message' as const,
    message_type: 'private' as const,
    sub_type: 'friend',
    message_id: messageId,
    user_id: 1109256353,
    time: 1_700_000_000 + messageId,
    message: [{ type: 'text' as const, data: { text } }],
    raw_message: text,
    font: 0,
    sender: { user_id: 1109256353, nickname: 'Alice' },
  };
}

describe('PrivateContextStore', () => {
  it('keeps an isolated private conversation, bot replies, and compaction work', () => {
    const store = new PrivateContextStore();
    store.record(event(1, 'first'));
    store.record(event(2, 'second'));
    store.recordOutgoing(1109256353, 3, 'bot reply');

    expect(store.buildAgentInput(1109256353, 3, 500)).toContain('机器人: bot reply');
    expect(store.needsCompaction(1109256353, 3)).toBe(true);
    expect(store.buildCompactionInput(1109256353).count).toBe(3);
    store.markCompacted(1109256353, 3);
    expect(store.needsCompaction(1109256353, 1)).toBe(false);
    expect(store.buildAgentInput(42, 3, 500)).toBe('');
  });

  it('exposes only images captured from messages in the selected private chat', () => {
    const store = new PrivateContextStore();
    const imageEvent = event(4, 'look') as ReturnType<typeof event> & { message: Array<unknown> };
    imageEvent.message.push({ type: 'image', data: { file: 'opaque-onebot-file' } });
    store.record(imageEvent);

    expect(store.buildAgentInput(1109256353, 1, 500)).toContain('[图片 message=4 image=1]');
    expect(store.findImage(1109256353, 4, 1)?.file).toBe('opaque-onebot-file');
    expect(store.findImage(1109256353, 4, 2)).toBeNull();
  });

  it('can build a shared chronological context without changing isolated contexts', () => {
    const store = new PrivateContextStore();
    store.record(event(5, 'from Alice'));
    const bobEvent = { ...event(6, 'from Bob'), user_id: 42, sender: { user_id: 42, nickname: 'Bob' } };
    store.record(bobEvent);
    store.recordOutgoing(42, 7, 'reply to Bob');

    expect(store.buildAgentInput(1109256353, 3, 500)).toContain('from Alice');
    expect(store.buildAgentInput(1109256353, 3, 500)).not.toContain('from Bob');
    expect(store.buildSharedAgentInput(3, 500)).toContain('QQ 1109256353 Alice: from Alice');
    expect(store.buildSharedAgentInput(3, 500)).toContain('QQ 42 Bob: from Bob');
    expect(store.needsSharedCompaction(3)).toBe(true);
    store.markSharedCompacted(3);
    expect(store.needsSharedCompaction(1)).toBe(false);
  });
});
