import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  contentHash, extFromRef, saveCandidate, renderCandidates, applyCandidates, type CollectCandidate,
} from './face-collect.js';

describe('contentHash / extFromRef', () => {
  it('同内容同 hash，不同内容不同', () => {
    expect(contentHash(Buffer.from('abc'))).toBe(contentHash(Buffer.from('abc')));
    expect(contentHash(Buffer.from('abc'))).not.toBe(contentHash(Buffer.from('abd')));
  });

  it('从引用取扩展名，未知回退 jpg', () => {
    expect(extFromRef('a.PNG')).toBe('.png');
    expect(extFromRef('https://x/y.gif?t=1')).toBe('.gif');
    expect(extFromRef('weird')).toBe('.jpg');
    expect(extFromRef('a.exe')).toBe('.jpg');
  });
});

describe('saveCandidate', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'qce-face-')); });
  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* 沙箱 */ } });

  it('首次写入返回 added=true 并落盘', () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);
    const { added, candidate } = saveCandidate(png, 'x.png', dir, new Set());
    expect(added).toBe(true);
    expect(candidate.ext).toBe('.png');
    expect(readdirSync(dir)).toContain(`${candidate.hash}.png`);
  });

  it('已存在 hash 时不重复写', () => {
    const first = saveCandidate(Buffer.from('img'), 'x.png', dir, new Set());
    const known = new Set([first.candidate.hash]);
    const second = saveCandidate(Buffer.from('img'), 'x.png', dir, known);
    expect(second.added).toBe(false);
    expect(readdirSync(dir)).toHaveLength(1);
  });
});

describe('renderCandidates', () => {
  const cands: CollectCandidate[] = [
    { hash: 'a'.repeat(64), ext: '.png', bytes: 2048, source: 'x' },
    { hash: 'b'.repeat(64), ext: '.jpg', bytes: 1024, source: 'y' },
  ];

  it('空候选给提示', () => {
    expect(renderCandidates([])).toContain('没有新候选');
  });

  it('渲染大小与 hash 前缀', () => {
    const text = renderCandidates(cands);
    expect(text).toContain('2 KB');
    expect(text).toContain('aaaaaaaaaa');
  });

  it('超出 limit 显示省略', () => {
    expect(renderCandidates(cands, 1)).toContain('还有 1 个');
  });
});

describe('applyCandidates', () => {
  let root: string;
  let candDir: string;
  let libDir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'qce-apply-'));
    candDir = join(root, 'cand');
    libDir = join(root, 'lib');
    mkdirSync(candDir, { recursive: true });
  });
  afterEach(() => { try { rmSync(root, { recursive: true, force: true }); } catch { /* 沙箱 */ } });

  it('把候选复制进库并追加 manifest', () => {
    const buf = Buffer.from('image-bytes');
    writeFileSync(join(candDir, 'abc.png'), buf);
    const manifest = { version: 1 as const, emojis: [] as any[] };
    const r = applyCandidates([{ hash: 'abc', ext: '.png', bytes: buf.length, source: 'x' }], candDir, libDir, manifest);
    expect(r.added).toBe(1);
    expect(manifest.emojis[0].label).toBe('（待分类）');
    expect(readFileSync(join(libDir, 'abc.png'))).toEqual(buf);
  });

  it('已在 manifest 里的跳过', () => {
    writeFileSync(join(candDir, 'abc.png'), 'x');
    const manifest = { version: 1 as const, emojis: [{ hash: 'abc', label: '旧', file: 'abc.png', importedAt: '' }] };
    expect(applyCandidates([{ hash: 'abc', ext: '.png', bytes: 1, source: '' }], candDir, libDir, manifest).added).toBe(0);
  });

  it('候选文件不存在时跳过', () => {
    const manifest = { version: 1 as const, emojis: [] as any[] };
    expect(applyCandidates([{ hash: 'missing', ext: '.png', bytes: 1, source: '' }], candDir, libDir, manifest).added).toBe(0);
  });
});

import { detectImageExt, imageSize, looksLikeEmoji } from './face-collect.js';

// 构造最小 PNG 头（只用于读宽高）
function pngBytes(w: number, h: number): Buffer {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}

describe('detectImageExt', () => {
  it('按魔数识别 png / jpg / gif / webp', () => {
    expect(detectImageExt(pngBytes(10, 10))).toBe('.png');
    expect(detectImageExt(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('.jpg');
    expect(detectImageExt(Buffer.from('GIF89a'))).toBe('.gif');
    expect(detectImageExt(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]))).toBe('.webp');
  });

  it('认不出时回退 jpg', () => {
    expect(detectImageExt(Buffer.from('not-an-image'))).toBe('.jpg');
  });
});

describe('imageSize', () => {
  it('读 PNG 宽高', () => {
    expect(imageSize(pngBytes(800, 600))).toEqual({ width: 800, height: 600 });
  });

  it('读 GIF 宽高', () => {
    const b = Buffer.alloc(10);
    b.write('GIF89a', 0);
    b.writeUInt16LE(320, 6);
    b.writeUInt16LE(240, 8);
    expect(imageSize(b)).toEqual({ width: 320, height: 240 });
  });

  it('非图片返回 null', () => {
    expect(imageSize(Buffer.from('hello'))).toBeNull();
  });
});

describe('looksLikeEmoji', () => {
  it('正常表情通过', () => {
    expect(looksLikeEmoji(pngBytes(400, 400)).ok).toBe(true);
  });

  it('大分辨率截图被拒', () => {
    const v = looksLikeEmoji(pngBytes(1920, 1080));
    expect(v.ok).toBe(false);
    expect(v.reason).toContain('分辨率');
  });

  it('宽长条被拒', () => {
    const v = looksLikeEmoji(pngBytes(1200, 200));
    expect(v.ok).toBe(false);
    expect(v.reason).toContain('比例');
  });

  it('超过 1.5MB 被拒', () => {
    const big = Buffer.concat([pngBytes(64, 64), Buffer.alloc(2 * 1024 * 1024)]);
    expect(looksLikeEmoji(big).ok).toBe(false);
  });

  it('读不出尺寸时保守放行', () => {
    expect(looksLikeEmoji(Buffer.from('GIF89a')).ok).toBe(true);
  });
});
