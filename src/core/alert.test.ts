import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { matchRule, pickHits, ruleId, AlertStore, type AlertRule, type AlertMessage, type AlertState } from './alert.js';

function rule(over: Partial<AlertRule> = {}): AlertRule {
  return { id: 'r1', pattern: '报错', to: '10001000', ...over };
}

function msg(over: Partial<AlertMessage> = {}): AlertMessage {
  return { id: 'm1', groupId: 100, time: 1000, senderId: 1, senderName: '张三', text: '服务又报错了', ...over };
}

const emptyState = (): AlertState => ({ notified: {} });

describe('matchRule', () => {
  it('关键词大小写不敏感', () => {
    expect(matchRule(rule({ pattern: 'ERROR' }), msg({ text: 'got an error' }))).toBe(true);
  });

  it('中文子串匹配', () => {
    expect(matchRule(rule(), msg())).toBe(true);
  });

  it('群限定生效', () => {
    expect(matchRule(rule({ groupId: 200 }), msg({ groupId: 100 }))).toBe(false);
    expect(matchRule(rule({ groupId: 100 }), msg({ groupId: 100 }))).toBe(true);
  });

  it('正则模式', () => {
    expect(matchRule(rule({ pattern: '\\d{3}错误', regex: true }), msg({ text: '出现 500错误' }))).toBe(true);
    expect(matchRule(rule({ pattern: '[', regex: true }), msg())).toBe(false); // 非法正则不炸
  });

  it('禁用的规则不匹配', () => {
    expect(matchRule(rule({ enabled: false }), msg())).toBe(false);
  });
});

describe('pickHits', () => {
  it('命中并返回规则与消息', () => {
    const hits = pickHits([rule()], [msg()], emptyState());
    expect(hits).toHaveLength(1);
    expect(hits[0].message.id).toBe('m1');
  });

  it('已提醒过的消息不再提醒（重启幂等）', () => {
    const state = emptyState();
    state.notified['r1:m1'] = 1000;
    expect(pickHits([rule()], [msg()], state)).toHaveLength(0);
  });

  it('冷却窗口内同规则只提醒一次', () => {
    const r = rule({ cooldownSec: 600 });
    const state = emptyState();
    state.notified['r1:m0'] = 1000;
    const hits = pickHits([r], [msg({ id: 'm2' })], state, 1000 + 60);
    expect(hits).toHaveLength(0);
    const later = pickHits([r], [msg({ id: 'm3' })], state, 1000 + 601);
    expect(later).toHaveLength(1);
  });

  it('多条规则各自匹配', () => {
    const r2 = rule({ id: 'r2', pattern: '报错', to: '20002000' });
    const hits = pickHits([rule(), r2], [msg()], emptyState());
    expect(hits.map((h) => h.rule.id).sort()).toEqual(['r1', 'r2']);
  });

  it('不匹配的消息不产生提醒', () => {
    expect(pickHits([rule()], [msg({ text: '今天天气不错' })], emptyState())).toHaveLength(0);
  });
});

describe('ruleId', () => {
  it('同内容同 id，不同目标不同 id', () => {
    const a = ruleId({ pattern: '报错', to: '1', regex: false });
    expect(ruleId({ pattern: '报错', to: '1', regex: false })).toBe(a);
    expect(ruleId({ pattern: '报错', to: '2', regex: false })).not.toBe(a);
  });
});

describe('AlertStore', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'qce-alert-'));
  });

  afterEach(() => {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* 沙箱下可能删不掉 */ }
  });

  it('空文件返回空规则', () => {
    const store = new AlertStore(root);
    expect(store.load()).toEqual({ rules: [], state: { notified: {} } });
  });

  it('保存后可读回', () => {
    const store = new AlertStore(root);
    store.save([rule()], { notified: { 'r1:m1': 123 } });
    const back = store.load();
    expect(back.rules).toHaveLength(1);
    expect(back.state.notified['r1:m1']).toBe(123);
  });

  it('坏文件不抛错', () => {
    const store = new AlertStore(root);
    store.save([rule()], { notified: {} });
    writeFileSync(store.file, '{bad json', 'utf8');
    expect(store.load().rules).toEqual([]);
  });
});
