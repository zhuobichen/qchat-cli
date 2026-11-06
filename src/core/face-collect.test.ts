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
    const { added, candidate } = saveCandidate(Buffer.from('img'), 'x.png', dir, new Set());
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
