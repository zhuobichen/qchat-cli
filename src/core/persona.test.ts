import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadGroupPersona, saveGroupPersona, buildPersonaBlock } from './persona.js';

describe('persona', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'qce-persona-')); });
  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* sandbox */ } });

  it('没有文件返回 null', () => {
    expect(loadGroupPersona('913807639', { dir })).toBeNull();
  });

  it('save 后可读回', () => {
    saveGroupPersona('913807639', '贴吧老哥人格', { dir });
    expect(loadGroupPersona('913807639', { dir })).toContain('贴吧老哥');
  });

  it('不同群互不串味', () => {
    saveGroupPersona('111', 'A 群人格', { dir });
    saveGroupPersona('222', 'B 群人格', { dir });
    expect(loadGroupPersona('111', { dir })).toContain('A 群');
    expect(loadGroupPersona('222', { dir })).toContain('B 群');
  });

  it('超长截断到 maxChars', () => {
    saveGroupPersona('333', 'x'.repeat(500), { dir });
    expect(loadGroupPersona('333', { dir, maxChars: 100 })!.length).toBe(100);
  });

  it('空白文件视为没有', () => {
    writeFileSync(join(dir, '444.md'), '   \n', 'utf8');
    expect(loadGroupPersona('444', { dir })).toBeNull();
  });

  it('注入块带边界说明', () => {
    const block = buildPersonaBlock('我是乐子人');
    expect(block).toContain('不改变安全规则');
    expect(block).toContain('我是乐子人');
    expect(block).toContain('不得辱骂');
  });
});
