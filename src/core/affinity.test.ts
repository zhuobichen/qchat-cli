import { describe, it, expect } from 'vitest';

import {
  applyInteraction,
  extractTopics,
  loadAffinity,
  rankByAffinity,
  rawScore,
  recordTopics,
  renderProfileForPrompt,
  renderRelationForPrompt,
  scoreOf,
  tagOf,
  topTopics,
  type AffinityFile,
} from './affinity.js';

const empty = (): AffinityFile => ({ version: 1, users: {} });

describe('affinity 好感度', () => {
  it('新人第一次互动后是生面孔', () => {
    const f = empty();
    const r = applyInteraction(f, '100', 'from', { name: '小明', now: 1_700_000_000_000 });
    expect(r.after).toBe('stranger');
    expect(f.users['100'].msgsFrom).toBe(1);
  });

  it('接话权重最高（engaged ×3）', () => {
    const a = applyInteraction(empty(), '1', 'from').record;
    const b = empty();
    const bb = applyInteraction(b, '1', 'engaged').record;
    expect(rawScore(bb)).toBeGreaterThan(rawScore(a));
    expect(rawScore(bb)).toBe(3);
  });

  it('多聊几次会升到眼熟/熟人', () => {
    const f = empty();
    const now = 1_700_000_000_000;
    let tag = 'stranger';
    for (let i = 0; i < 8; i += 1) {
      tag = applyInteraction(f, '1', 'from', { now }).after;
    }
    expect(tag).not.toBe('stranger');
  });

  it('老哥级需要足够的接话次数', () => {
    const f = empty();
    const now = 1_700_000_000_000;
    for (let i = 0; i < 12; i += 1) applyInteraction(f, '1', 'engaged', { now });
    expect(tagOf(f.users['1'], now)).toBe('friend');
  });

  it('45 天不说话分数减半', () => {
    const now = 1_700_000_000_000;
    const r = applyInteraction(empty(), '1', 'engaged', { now }).record;
    const s0 = scoreOf(r, now);
    const s45 = scoreOf(r, now + 45 * 86400_000);
    expect(s45).toBeCloseTo(s0 / 2, 5);
  });

  it('人工 tag 覆盖自动档位', () => {
    const f = empty();
    applyInteraction(f, '1', 'from');
    f.users['1'].tag = 'friend';
    expect(tagOf(f.users['1'])).toBe('friend');
  });

  it('关系变化会被报出来', () => {
    const f = empty();
    const now = 1_700_000_000_000;
    applyInteraction(f, '1', 'from', { now });
    // 升档只发生在跨越阈值的那一次，所以要收集整个过程
    const changes = [];
    for (let i = 0; i < 20; i += 1) changes.push(applyInteraction(f, '1', 'engaged', { now }).changed);
    expect(changes.some(Boolean)).toBe(true);
  });

  it('没记录的人渲染成生面孔提示', () => {
    const t = renderRelationForPrompt(null);
    expect(t).toContain('生面孔');
  });

  it('老哥的提示里允许损人', () => {
    const f = empty();
    const now = 1_700_000_000_000;
    for (let i = 0; i < 12; i += 1) applyInteraction(f, '1', 'engaged', { now, name: '老王' });
    const t = renderRelationForPrompt(f.users['1'], now);
    expect(t).toContain('老王');
    expect(t).toMatch(/损|找茬/);
  });

  it('很久不见的老哥会被提醒别装熟', () => {
    const f = empty();
    const now = 1_700_000_000_000;
    // 20 次接话 = 60 分。20 天后衰减到约 44，仍是老哥档但要提醒别装熟。
    for (let i = 0; i < 20; i += 1) applyInteraction(f, '1', 'engaged', { now, name: '老王' });
    const later = now + 20 * 86400_000;
    expect(renderRelationForPrompt(f.users['1'], later)).toContain('别装熟');
  });

  it('太久不联系会掉档，不再提醒装不装熟（已经是熟人了）', () => {
    const f = empty();
    const now = 1_700_000_000_000;
    for (let i = 0; i < 12; i += 1) applyInteraction(f, '1', 'engaged', { now, name: '老王' });
    const later = now + 60 * 86400_000;
    expect(tagOf(f.users['1'], later)).toBe('regular');
  });

  it('话题抽取只返回命中词', () => {
    expect(extractTopics('今天抽卡歪了，原神真难')).toContain('原神');
    expect(extractTopics('今天天气不错')).toEqual([]);
  });

  it('话题计数与 top 排序', () => {
    const f = empty();
    const r = applyInteraction(f, '1', 'from').record;
    recordTopics(r, ['原神', '原神', '编程']);
    expect(topTopics(r)[0]).toBe('原神');
  });

  it('画像里带常聊话题', () => {
    const f = empty();
    const now = 1_700_000_000_000;
    for (let i = 0; i < 12; i += 1) applyInteraction(f, '1', 'engaged', { now, name: '老王' });
    recordTopics(f.users['1'], ['原神', '原神']);
    expect(renderProfileForPrompt(f.users['1'], now)).toContain('原神');
  });

  it('排行榜按分数降序', () => {
    const f = empty();
    const now = 1_700_000_000_000;
    for (let i = 0; i < 5; i += 1) applyInteraction(f, 'a', 'engaged', { now });
    applyInteraction(f, 'b', 'from', { now });
    const rank = rankByAffinity(f, now);
    expect(rank[0].r.uin).toBe('a');
  });

  it('文件损坏时返回空而不是崩', () => {
    expect(loadAffinity('这个文件不存在.json').users).toEqual({});
  });
});
