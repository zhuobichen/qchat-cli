import { describe, expect, it } from 'vitest';
import { GroupContextStore } from './group-context.js';
import { getMentionedText } from './group-agent.js';

function event(messageId: number, text: string) {
  return {
    post_type: 'message' as const,
    message_type: 'group' as const,
    sub_type: 'normal',
    group_id: 1109256353,
    message_id: messageId,
    user_id: 1,
    time: 1_700_000_000 + messageId,
    message: [{ type: 'text' as const, data: { text } }],
    raw_message: text,
    font: 0,
    sender: { user_id: 1, nickname: 'Alice', card: '', role: 'member' as const },
  };
}

describe('GroupContextStore', () => {
  it('keeps bot replies in the bounded context and tracks compaction work', () => {
    const store = new GroupContextStore();
    store.record(event(1, 'first'));
    store.record(event(2, 'second'));
    store.recordOutgoing(1109256353, 3, 'bot reply');

    expect(store.buildAgentInput(1109256353, 3, 500)).toContain('机器人: bot reply');
    expect(store.needsCompaction(1109256353, 3)).toBe(true);
    expect(store.buildCompactionInput(1109256353).count).toBe(3);
    store.markCompacted(1109256353, 3);
    expect(store.needsCompaction(1109256353, 1)).toBe(false);
  });

  it('exposes only images captured from messages in the current context', () => {
    const store = new GroupContextStore();
    const imageEvent = event(4, 'look') as ReturnType<typeof event> & { message: Array<unknown> };
    imageEvent.message.push({ type: 'image', data: { file: 'opaque-onebot-file' } });
    store.record(imageEvent);

    expect(store.buildAgentInput(1109256353, 1, 500)).toContain('[图片 message=4 image=1]');
    expect(store.findImage(1109256353, 4, 1)?.file).toBe('opaque-onebot-file');
    expect(store.findImage(1109256353, 4, 2)).toBeNull();
  });

  it('recognizes a standalone mention when NapCat only preserves the raw display text', () => {
    const mentionOnly: any = event(5, '');
    mentionOnly.message = [{ type: 'at', data: {} }];
    mentionOnly.raw_message = '@FFantasy';

    expect(getMentionedText(mentionOnly, 99, 'FFantasy')).toBe('');
    mentionOnly.raw_message = '@AnotherMember';
    expect(getMentionedText(mentionOnly, 99, 'FFantasy')).toBeNull();
  });
});
