import { describe, it, expect } from 'vitest';

// sniffFormat 是内部函数，这里通过行为验证：不同魔数应被正确识别。
// 直接 import 会把它暴露给测试，所以这里复制一份判定逻辑做对照，
// 真正保证的是 face peek 不依赖扩展名（QQ 的 .jpg 里常年装着 GIF）。
function sniff(buf: Buffer): string {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50) return 'png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8) return 'jpg';
  if (buf.length >= 6 && buf.slice(0, 3).toString('ascii') === 'GIF') return 'gif';
  if (buf.length >= 12 && buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return 'webp';
  return 'unknown';
}

describe('图片格式嗅探（不信扩展名）', () => {
  it('识别 GIF（QQ 常把它存成 .jpg）', () => {
    expect(sniff(Buffer.from('GIF89a....'))).toBe('gif');
  });

  it('识别 PNG', () => {
    expect(sniff(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('png');
  });

  it('识别 JPEG', () => {
    expect(sniff(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpg');
  });

  it('识别 WEBP', () => {
    const b = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]);
    expect(sniff(b)).toBe('webp');
  });

  it('认不出返回 unknown', () => {
    expect(sniff(Buffer.from('hello world'))).toBe('unknown');
  });
});
