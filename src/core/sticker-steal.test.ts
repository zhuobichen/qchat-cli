import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  addStolenSticker,
  consumeQuota,
  judgeStealable,
  loadManifestAt,
  loadQuota,
  probeImageSize,
  remainingQuota,
} from './sticker-steal.js';

/** 造一个最小合法 PNG（1x1）并放大到指定尺寸头 */
function fakePng(width: number, height: number, paddingTo = 2000): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4, 'ascii');
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  const pad = Buffer.alloc(Math.max(0, paddingTo - 33));
  return Buffer.concat([sig, ihdr, pad]);
}

function fakeGif(width: number, height: number, frames = 1, paddingTo = 2000): Buffer {
  const head = Buffer.alloc(13);
  head.write('GIF89a', 0, 'ascii');
  head.writeUInt16LE(width, 6);
  head.writeUInt16LE(height, 8);
  const body = Buffer.from('NETSCAPE2.0'.repeat(frames), 'ascii');
  const pad = Buffer.alloc(Math.max(0, paddingTo - 13 - body.length));
  return Buffer.concat([head, body, pad]);
}

describe('sticker-steal 偷表情包', () => {
  it('读出 PNG 尺寸', () => {
    const s = probeImageSize(fakePng(240, 240));
    expect(s.width).toBe(240);
    expect(s.height).toBe(240);
  });

  it('读出 GIF 尺寸并识别动图', () => {
    const one = probeImageSize(fakeGif(100, 100, 1));
    expect(one.width).toBe(100);
    expect(one.animated).toBeFalsy();
    const many = probeImageSize(fakeGif(100, 100, 3));
    expect(many.animated).toBe(true);
  });

  it('动图直接收', () => {
    expect(judgeStealable({ buffer: fakeGif(120, 120, 3), isAnimated: true }).accept).toBe(true);
  });

  it('太小的不收', () => {
    expect(judgeStealable({ buffer: Buffer.alloc(100) }).accept).toBe(false);
  });

  it('太大的不收', () => {
    expect(judgeStealable({ buffer: Buffer.alloc(3 * 1024 * 1024) }).accept).toBe(false);
  });

  it('长图不收', () => {
    const v = judgeStealable({ buffer: fakePng(200, 1200), width: 200, height: 1200 });
    expect(v.accept).toBe(false);
    expect(v.reason).toContain('长宽比');
  });

  it('分辨率过高的不收（截图/照片）', () => {
    const v = judgeStealable({ buffer: fakePng(2000, 1500), width: 2000, height: 1500 });
    expect(v.accept).toBe(false);
    expect(v.reason).toContain('分辨率');
  });

it('严格模式挡掉偏大的图（可能是截图）', () => {
    const buf = fakePng(900, 900);
    expect(judgeStealable({ buffer: buf, width: 900, height: 900 }).accept).toBe(true);
    const strict = judgeStealable({ buffer: buf, width: 900, height: 900, strict: true });
    expect(strict.accept).toBe(false);
    expect(strict.reason).toContain('截图');
  });

  it('严格模式对标准表情尺寸仍然放行', () => {
    const buf = fakePng(300, 300);
    expect(judgeStealable({ buffer: buf, width: 300, height: 300, strict: true }).accept).toBe(true);
  });

  it('严格模式挡掉像素偏多的图（可能是照片）', () => {
    const buf = fakePng(800, 800);
    const v = judgeStealable({ buffer: buf, width: 800, height: 800, strict: true });
    expect(v.accept).toBe(false);
  });

  it('正常方图收', () => {
    const v = judgeStealable({ buffer: fakePng(240, 240), width: 240, height: 240 });
    expect(v.accept).toBe(true);
  });

  describe('入库', () => {
    let dir: string;
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'steal-'));
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it('存进去并写 manifest', () => {
      const buf = fakePng(240, 240);
      const r = addStolenSticker(dir, { buffer: buf, fromUin: '123', fromName: '老王', scope: 'g1' });
      expect(r.added).toBe(true);
      const m = loadManifestAt(join(dir, 'manifest.json'));
      expect(m.emojis).toHaveLength(1);
      expect(m.emojis[0].stolenFrom?.name).toBe('老王');
      expect(m.emojis[0].stolenFrom?.scope).toBe('g1');
    });

    it('同一张图不重复收', () => {
      const buf = fakePng(240, 240);
      addStolenSticker(dir, { buffer: buf });
      const again = addStolenSticker(dir, { buffer: buf });
      expect(again.added).toBe(false);
      expect(again.reason).toContain('已经有了');
    });

    it('不合规的图不入库', () => {
      const r = addStolenSticker(dir, { buffer: Buffer.alloc(100) });
      expect(r.added).toBe(false);
      expect(loadManifestAt(join(dir, 'manifest.json')).emojis).toHaveLength(0);
    });

    it('默认标签带来源名', () => {
      const r = addStolenSticker(dir, { buffer: fakePng(200, 200), fromName: '小明' });
      expect(r.label).toContain('小明');
    });

    it('可以指定标签', () => {
      const r = addStolenSticker(dir, { buffer: fakePng(200, 200), label: '无语 翻白眼 熊猫头' });
      expect(r.label).toBe('无语 翻白眼 熊猫头');
    });
  });

  describe('限流', () => {
    let path: string;
    beforeEach(() => {
      path = join(mkdtempSync(join(tmpdir(), 'quota-')), 'q.json');
    });

    it('新的一天额度是满的', () => {
      expect(remainingQuota('g1', 8, loadQuota(path), 1_700_000_000_000)).toBe(8);
    });

    it('收一张扣一格', () => {
      const q = loadQuota(path);
      consumeQuota('g1', q, 1_700_000_000_000);
      expect(remainingQuota('g1', 8, q, 1_700_000_000_000)).toBe(7);
    });

    it('额度用完就是 0', () => {
      const q = loadQuota(path);
      for (let i = 0; i < 8; i += 1) consumeQuota('g1', q, 1_700_000_000_000);
      expect(remainingQuota('g1', 8, q, 1_700_000_000_000)).toBe(0);
    });

    it('不同群独立计数', () => {
      const q = loadQuota(path);
      consumeQuota('g1', q, 1_700_000_000_000);
      expect(remainingQuota('g2', 8, q, 1_700_000_000_000)).toBe(8);
    });
  });
});
