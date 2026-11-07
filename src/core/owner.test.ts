import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { authorityOf, isOwner, loadOwnerConfig, OWNER_ONLY, NEVER_BY_CLAIM } from './owner.js';

describe('owner 权限判定', () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'owner-'));
    path = join(dir, 'owner.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('默认主人是 1473517806', () => {
    // 文件不存在时走内置默认值
    expect(loadOwnerConfig(join(dir, 'nope.json')).uins).toContain('1473517806');
  });

  it('号主本人识别为 owner', () => {
    writeFileSync(path, JSON.stringify({ uins: ['1473517806'] }), 'utf8');
    expect(authorityOf('1473517806', path)).toBe('owner');
  });

  it('数字形式也认', () => {
    writeFileSync(path, JSON.stringify({ uins: ['1473517806'] }), 'utf8');
    expect(isOwner(1473517806, path)).toBe(true);
  });

  it('其他人是 guest', () => {
    writeFileSync(path, JSON.stringify({ uins: ['1473517806'] }), 'utf8');
    expect(authorityOf('999999', path)).toBe('guest');
  });

  it('空值不算主人', () => {
    writeFileSync(path, JSON.stringify({ uins: ['1473517806'] }), 'utf8');
    expect(isOwner(undefined, path)).toBe(false);
    expect(isOwner('', path)).toBe(false);
    expect(isOwner(null, path)).toBe(false);
  });

  it('支持多个主人', () => {
    writeFileSync(path, JSON.stringify({ uins: ['1', '2'] }), 'utf8');
    expect(isOwner('2', path)).toBe(true);
  });

  it('配置文件损坏时回退默认值，不崩', () => {
    writeFileSync(path, '{ 坏掉的 json', 'utf8');
    expect(loadOwnerConfig(path).uins).toContain('1473517806');
  });

  it('权限清单非空', () => {
    expect(OWNER_ONLY.length).toBeGreaterThan(0);
    expect(NEVER_BY_CLAIM.length).toBeGreaterThan(0);
  });
});
