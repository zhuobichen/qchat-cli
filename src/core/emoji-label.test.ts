import { describe, it, expect } from 'vitest';
import { needsLabel, pickUnlabeled, cleanLabel, describeImage, loadManifestFile, saveManifest, type EmojiManifest } from './emoji-label.js';

const manifest: EmojiManifest = {
  version: 1,
  emojis: [
    { hash: 'a', label: '（待分类）', file: 'a.png', importedAt: '' },
    { hash: 'b', label: '无语 翻白眼', file: 'b.png', importedAt: '' },
    { hash: 'c', label: '  ', file: 'c.png', importedAt: '' },
    { hash: 'd', label: '未分类', file: 'd.png', importedAt: '' },
  ],
};

describe('needsLabel / pickUnlabeled', () => {
  it('空标签与待分类都算待标', () => {
    expect(needsLabel(manifest.emojis[0])).toBe(true);
    expect(needsLabel(manifest.emojis[2])).toBe(true);
    expect(needsLabel(manifest.emojis[3])).toBe(true);
    expect(needsLabel(manifest.emojis[1])).toBe(false);
  });

  it('只挑待标项并限制数量', () => {
    expect(pickUnlabeled(manifest).map((e) => e.hash)).toEqual(['a', 'c', 'd']);
    expect(pickUnlabeled(manifest, 2)).toHaveLength(2);
  });
});

describe('cleanLabel', () => {
  it('去引号与前言', () => {
    expect(cleanLabel('“无语翻白眼”')).toBe('无语翻白眼');
    expect(cleanLabel('表情包：庆祝撒花')).toBe('庆祝撒花');
    expect(cleanLabel('这张表情是嘲讽')).toBe('这张表情是嘲讽');
  });

  it('合并换行并限长 20 字', () => {
    expect(cleanLabel('第一行\n第二行')).toBe('第一行 第二行');
    expect(cleanLabel('字'.repeat(50))!.length).toBe(20);
  });

  it('空内容返回 null', () => {
    expect(cleanLabel('   ')).toBeNull();
    expect(cleanLabel('""')).toBeNull();
  });
});

describe('describeImage', () => {
  const png = Buffer.from('89504e470d0a1a0a', 'hex');

  it('成功时返回清洗后的描述', async () => {
    const fake = (async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '“无语翻白眼”' } }] }),
    } as any)) as unknown as typeof fetch;
    expect(await describeImage(png, { apiKey: 'k', fetchImpl: fake })).toBe('无语翻白眼');
  });

  it('无 key / 空图不发请求', async () => {
    expect(await describeImage(png, { apiKey: '' })).toBeNull();
    expect(await describeImage(Buffer.alloc(0), { apiKey: 'k' })).toBeNull();
  });

  it('接口错误返回 null', async () => {
    const fake = (async () => ({ ok: false, status: 500 } as any)) as unknown as typeof fetch;
    expect(await describeImage(png, { apiKey: 'k', fetchImpl: fake })).toBeNull();
  });

  it('网络异常返回 null', async () => {
    const fake = (async () => { throw new Error('boom'); }) as unknown as typeof fetch;
    expect(await describeImage(png, { apiKey: 'k', fetchImpl: fake })).toBeNull();
  });

  it('模型返回空内容时返回 null', async () => {
    const fake = (async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '  ' } }] }) } as any)) as unknown as typeof fetch;
    expect(await describeImage(png, { apiKey: 'k', fetchImpl: fake })).toBeNull();
  });
});

describe('manifest 读写', () => {
  it('缺失文件返回空 manifest', () => {
    expect(loadManifestFile('Z:/nope/manifest.json').emojis).toEqual([]);
  });

  it('save 后可 load（用临时目录）', async () => {
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'qce-emoji-'));
    const p = join(dir, 'manifest.json');
    saveManifest(p, manifest);
    expect(loadManifestFile(p).emojis).toHaveLength(4);
  });
});
