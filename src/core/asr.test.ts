import { describe, it, expect } from 'vitest';
import { toVoiceMessages, runAsr, defaultAsrScript } from './asr.js';
import { voiceRefs } from './history.js';

describe('voiceRefs', () => {
  it('取 record/voice 段的 file，其次 url/path', () => {
    const segs = [
      { type: 'text', data: { text: '听这个' } },
      { type: 'record', data: { file: 'abc.amr' } },
      { type: 'voice', data: { url: 'http://x/v.mp3' } },
      { type: 'record', data: { path: 'local.wav' } },
      { type: 'record', data: {} },
    ];
    expect(voiceRefs(segs)).toEqual(['abc.amr', 'http://x/v.mp3', 'local.wav']);
  });

  it('非数组返回空', () => {
    expect(voiceRefs(null)).toEqual([]);
    expect(voiceRefs('x')).toEqual([]);
  });

  it('没有语音段返回空', () => {
    expect(voiceRefs([{ type: 'image', data: { file: 'a.png' } }])).toEqual([]);
  });
});

describe('toVoiceMessages', () => {
  const base = { id: 'm9', groupId: 100, time: 1700000000, senderId: 3, senderName: '王五' };

  it('生成 asr 前缀的合成消息（幂等）', () => {
    const out = toVoiceMessages(base, [{ file: 'a.amr', text: '明天下午三点开会', language: 'zh' }]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('asr:m9:0');
    expect(out[0].text).toContain('[语音文字]');
    expect(out[0].text).toContain('明天下午三点开会');
    expect(out[0].groupId).toBe(100);
  });

  it('多条语音按序号递进', () => {
    const out = toVoiceMessages(base, [
      { file: 'a.amr', text: '第一条' },
      { file: 'b.amr', text: '第二条' },
    ]);
    expect(out.map((o) => o.id)).toEqual(['asr:m9:0', 'asr:m9:1']);
  });

  it('空文本与失败项被跳过', () => {
    const out = toVoiceMessages(base, [
      { file: 'a.amr', text: '   ' },
      { file: 'b.amr', text: '', error: 'decode failed' },
    ]);
    expect(out).toHaveLength(0);
  });
});

describe('runAsr', () => {
  it('空输入不调用子进程', () => {
    expect(runAsr([])).toEqual([]);
  });

  it('脚本缺失时安全返回空数组', () => {
    expect(runAsr(['a.mp3'], { script: 'Z:/missing.py' })).toEqual([]);
  });

  it('默认脚本路径指向 scripts/asr_audio.py', () => {
    expect(defaultAsrScript().replace(/\\/g, '/')).toMatch(/scripts\/asr_audio\.py$/);
  });
});
