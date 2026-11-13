import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadPersonaMode, savePersonaMode, loadGlobalPersona, loadGroupPersona,
  resolvePersona, saveGlobalPersona, saveGroupPersona, buildPersonaBlock,
  GLOBAL_PERSONA_NAME,
} from './persona.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'qce-persona-'));
});

describe('模式读写', () => {
  it('没配过默认 global', () => {
    expect(loadPersonaMode({ dir: join(dir, 'nope') })).toBe('global');
  });

  it('切到 per-scope 能读回', () => {
    savePersonaMode('per-scope', { dir });
    expect(loadPersonaMode({ dir })).toBe('per-scope');
  });

  it('切回 global', () => {
    savePersonaMode('per-scope', { dir });
    savePersonaMode('global', { dir });
    expect(loadPersonaMode({ dir })).toBe('global');
  });

  it('坏文件当作默认 global', () => {
    writeFileSync(join(dir, 'mode.json'), '{{{', 'utf8');
    expect(loadPersonaMode({ dir })).toBe('global');
  });
});

describe('resolvePersona 模式分流', () => {
  it('global 模式下只用 global.md，忽略按群文件', () => {
    savePersonaMode('global', { dir });
    saveGlobalPersona('全局人格', { dir });
    saveGroupPersona('913807639', '本群人格', { dir });
    const r = resolvePersona('913807639', { dir });
    expect(r.source).toBe('global');
    expect(r.text).toBe('全局人格');
  });

  it('per-scope 模式下优先按群文件', () => {
    savePersonaMode('per-scope', { dir });
    saveGlobalPersona('全局人格', { dir });
    saveGroupPersona('913807639', '本群人格', { dir });
    const r = resolvePersona('913807639', { dir });
    expect(r.source).toBe('scope');
    expect(r.text).toBe('本群人格');
  });

  it('per-scope 模式下没有专属文件则落到全局', () => {
    savePersonaMode('per-scope', { dir });
    saveGlobalPersona('全局人格', { dir });
    const r = resolvePersona('999999', { dir });
    expect(r.source).toBe('global');
    expect(r.text).toBe('全局人格');
  });

  it('两份都没有时返回 none', () => {
    savePersonaMode('global', { dir });
    const r = resolvePersona('913807639', { dir });
    expect(r.source).toBe('none');
    expect(r.text).toBeNull();
  });

  it('global 模式下即使没有 global.md 也不回退到按群文件', () => {
    savePersonaMode('global', { dir });
    saveGroupPersona('913807639', '本群人格', { dir });
    const r = resolvePersona('913807639', { dir });
    expect(r.source).toBe('none');
  });
});

describe('文件读写', () => {
  it('全局人格文件名是 friendly-ai.md（2026-11-13 起的新默认）', () => {
    expect(GLOBAL_PERSONA_NAME).toBe('friendly-ai');
    const f = saveGlobalPersona('x', { dir });
    expect(f.endsWith('friendly-ai.md')).toBe(true);
    expect(existsSync(f)).toBe(true);
  });

  it('新默认文件不存在时回退到旧人格（mowan → global）', () => {
    // 先确保新文件不在
    const fresh = mkdtempSync(join(tmpdir(), 'persona-legacy-'));
    writeFileSync(join(fresh, 'mowan.md'), '魔丸人格', 'utf8');
    expect(loadGlobalPersona({ dir: fresh })).toBe('魔丸人格');

    // mowan 也没有时退到更老的 global.md
    const older = mkdtempSync(join(tmpdir(), 'persona-legacy2-'));
    writeFileSync(join(older, 'global.md'), '贴吧老哥', 'utf8');
    expect(loadGlobalPersona({ dir: older })).toBe('贴吧老哥');
  });

  it('空文件当作没有', () => {
    writeFileSync(join(dir, 'global.md'), '   \n\n  ', 'utf8');
    expect(loadGlobalPersona({ dir })).toBeNull();
  });

  it('超长内容被截断', () => {
    saveGlobalPersona('啊'.repeat(10000), { dir });
    expect(loadGlobalPersona({ dir, maxChars: 100 })?.length).toBe(100);
  });

  it('读不存在的群返回 null', () => {
    expect(loadGroupPersona('123456', { dir })).toBeNull();
  });
});

describe('buildPersonaBlock', () => {
  it('包含边界声明', () => {
    const b = buildPersonaBlock('测试人格');
    expect(b).toContain('测试人格');
    expect(b).toContain('人格边界');
    expect(b).toContain('不改变安全规则');
  });
});
