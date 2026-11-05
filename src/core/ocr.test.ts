import { describe, it, expect } from 'vitest';
import { toSyntheticMessages, hasOcrEntries, runOcr } from './ocr.js';
import { imageRefs } from './history.js';

describe('imageRefs', () => {
  it('取 image 段的 file 优先，其次 url', () => {
    const segs = [
      { type: 'text', data: { text: '看图' } },
      { type: 'image', data: { file: 'abc.image', url: 'http://x/1.png' } },
      { type: 'image', data: { url: 'http://x/2.png' } },
      { type: 'image', data: {} },
    ];
    expect(imageRefs(segs)).toEqual(['abc.image', 'http://x/2.png']);
  });

  it('非数组返回空', () => {
    expect(imageRefs(null)).toEqual([]);
    expect(imageRefs('text')).toEqual([]);
  });

  it('没有图片段返回空', () => {
    expect(imageRefs([{ type: 'text', data: { text: 'hi' } }])).toEqual([]);
  });
});

describe('toSyntheticMessages', () => {
  const base = { id: 'm1', groupId: 100, time: 1700000000, senderId: 2, senderName: '张三' };

  it('生成带 ocr 前缀的合成消息，便于幂等', () => {
    const out = toSyntheticMessages(base, [{ file: 'a.png', text: '明天三点开会', lines: ['明天三点开会'] }]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('ocr:m1:0');
    expect(out[0].text).toContain('[图片文字]');
    expect(out[0].text).toContain('明天三点开会');
    expect(out[0].groupId).toBe(100);
  });

  it('多张图按序号递进', () => {
    const out = toSyntheticMessages(base, [
      { file: 'a.png', text: '第一张', lines: [] },
      { file: 'b.png', text: '第二张', lines: [] },
    ]);
    expect(out.map((o) => o.id)).toEqual(['ocr:m1:0', 'ocr:m1:1']);
  });

  it('空文本被跳过（OCR 失败不产生脏数据）', () => {
    const out = toSyntheticMessages(base, [
      { file: 'a.png', text: '   ', lines: [] },
      { file: 'b.png', text: '', lines: [], error: 'boom' },
    ]);
    expect(out).toHaveLength(0);
  });
});

describe('hasOcrEntries', () => {
  it('识别已做过 OCR 的消息', () => {
    expect(hasOcrEntries('m1', new Set(['m0', 'ocr:m1:0']))).toBe(true);
    expect(hasOcrEntries('m2', new Set(['m0', 'ocr:m1:0']))).toBe(false);
  });
});

describe('runOcr', () => {
  it('空输入不调用子进程', () => {
    expect(runOcr([])).toEqual([]);
  });

  it('脚本不存在时安全返回空数组', () => {
    expect(runOcr(['x.png'], { script: 'Z:/definitely/missing.py' })).toEqual([]);
  });

  it('可执行文件不存在时安全返回空数组', () => {
    expect(runOcr(['x.png'], { python: 'definitely-not-a-python' })).toEqual([]);
  });
});
