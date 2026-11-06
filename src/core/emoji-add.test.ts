import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { addDirectoryToLibrary, loadLibraryManifest, detectExt } from './emoji-add.js';

function png(w = 10, h = 10): Buffer {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}

describe('detectExt', () => {
  it('按魔数识别格式', () => {
    expect(detectExt(png())).toBe('.png');
    expect(detectExt(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('.jpg');
    expect(detectExt(Buffer.from('GIF89a'))).toBe('.gif');
    expect(detectExt(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]))).toBe('.webp');
  });
});

describe('addDirectoryToLibrary', () => {
  let src: string;
  let lib: string;

  beforeEach(() => {
    const root = mkdtempSync(join(tmpdir(), 'qce-emojiadd-'));
    src = join(root, 'src');
    lib = join(root, 'lib');
    mkdirSync(src, { recursive: true });
    mkdirSync(lib, { recursive: true });
  });
  afterEach(() => {
    try { rmSync(join(src, '..'), { recursive: true, force: true }); } catch { /* sandbox */ }
  });

  it('导入图片并写入 manifest', () => {
    writeFileSync(join(src, 'a.png'), png());
    const m = { version: 1 as const, emojis: [] as any[] };
    const { added } = addDirectoryToLibrary(src, lib, m);
    expect(added).toHaveLength(1);
    expect(m.emojis).toHaveLength(1);
    expect(readdirSync(lib)).toContain(added[0].file);
  });

  it('标签带前缀', () => {
    writeFileSync(join(src, 'a.png'), png());
    const m = { version: 1 as const, emojis: [] as any[] };
    addDirectoryToLibrary(src, lib, m, { labelPrefix: 'DeepSeek' });
    expect(m.emojis[0].label).toBe('DeepSeek a');
  });

  it('内容重复会跳过（同内容不同文件名）', () => {
    writeFileSync(join(src, 'a.png'), png());
    writeFileSync(join(src, 'b.png'), png());
    const m = { version: 1 as const, emojis: [] as any[] };
    const { added, skipped } = addDirectoryToLibrary(src, lib, m);
    expect(added).toHaveLength(1);
    expect(skipped.some((s) => s.reason.includes('已存在'))).toBe(true);
  });

  it('超过大小上限跳过', () => {
    writeFileSync(join(src, 'big.png'), Buffer.concat([png(), Buffer.alloc(2048)]));
    const m = { version: 1 as const, emojis: [] as any[] };
    const { added, skipped } = addDirectoryToLibrary(src, lib, m, { maxBytes: 1024 });
    expect(added).toHaveLength(0);
    expect(skipped[0].reason).toContain('超过');
  });

  it('非图片文件忽略', () => {
    writeFileSync(join(src, 'note.txt'), 'hello');
    const m = { version: 1 as const, emojis: [] as any[] };
    const { added, skipped } = addDirectoryToLibrary(src, lib, m);
    expect(added).toHaveLength(0);
    expect(skipped).toHaveLength(0);
  });

  it('扩展名标错时按真实格式存', () => {
    writeFileSync(join(src, 'wrong.jpg'), png());   // 内容是 png，名字是 jpg
    const m = { version: 1 as const, emojis: [] as any[] };
    const { added } = addDirectoryToLibrary(src, lib, m);
    expect(added[0].file.endsWith('.png')).toBe(true);
  });

  it('重复导入同一目录不会重复加', () => {
    writeFileSync(join(src, 'a.png'), png());
    const m = { version: 1 as const, emojis: [] as any[] };
    addDirectoryToLibrary(src, lib, m);
    const second = addDirectoryToLibrary(src, lib, m);
    expect(second.added).toHaveLength(0);
  });
});

describe('loadLibraryManifest', () => {
  it('不存在时返回空 manifest', () => {
    expect(loadLibraryManifest('Z:/nope').emojis).toEqual([]);
  });

  it('读回已写入的 manifest', () => {
    const dir = mkdtempSync(join(tmpdir(), 'qce-emojiadd2-'));
    const m = { version: 1 as const, emojis: [{ hash: 'h', label: 'L', file: 'h.png', importedAt: '' }] };
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(m), 'utf8');
    expect(loadLibraryManifest(dir).emojis).toHaveLength(1);
    rmSync(dir, { recursive: true, force: true });
  });
});
