import { describe, it, expect } from 'vitest';
import { flattenMessage, parseDuration } from './history.js';

describe('flattenMessage', () => {
  it('字符串原样返回', () => {
    expect(flattenMessage('你好')).toBe('你好');
  });

  it('拼接文本段并标注媒体', () => {
    const segs = [
      { type: 'text', data: { text: '看这个 ' } },
      { type: 'image', data: {} },
      { type: 'at', data: { qq: '10001000' } },
    ];
    expect(flattenMessage(segs)).toBe('看这个 [图片]@10001000');
  });

  it('@全体成员 特殊标注', () => {
    expect(flattenMessage([{ type: 'at', data: { qq: 'all' } }])).toBe('@全体成员');
  });

  it('未知段类型保留可读占位', () => {
    expect(flattenMessage([{ type: 'mystery', data: {} }])).toBe('[mystery]');
  });

  it('非数组返回空串', () => {
    expect(flattenMessage(null)).toBe('');
  });
});

describe('parseDuration', () => {
  it('解析常见单位', () => {
    expect(parseDuration('30m')).toBe(1800);
    expect(parseDuration('24h')).toBe(86400);
    expect(parseDuration('7d')).toBe(604800);
    expect(parseDuration('2w')).toBe(1209600);
  });

  it('纯数字按天', () => {
    expect(parseDuration('3')).toBe(259200);
  });

  it('非法输入返回 undefined', () => {
    expect(parseDuration(undefined)).toBeUndefined();
    expect(parseDuration('abc')).toBeUndefined();
    expect(parseDuration('-5d')).toBeUndefined();
  });
});
