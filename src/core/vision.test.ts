import { describe, it, expect } from 'vitest';
import { parseQwenVision, isQuotaOrAuthError, describeWithQwen, describeWithLocalVlm } from './vision.js';

describe('parseQwenVision', () => {
  it('解析三行标准输出', () => {
    const r = parseQwenVision('文字：哈哈哈哈\n情绪：大笑嘲讽\n角色：不确定');
    expect(r).toEqual({ text: '哈哈哈哈', emotion: '大笑嘲讽', character: '' });
  });

  it('"不确定"归一成空', () => {
    expect(parseQwenVision('角色：不确定').character).toBe('');
    expect(parseQwenVision('角色：不知道').character).toBe('');
  });

  it('空占位归一成空', () => {
    const r = parseQwenVision('文字：无\n情绪：无语');
    expect(r.text).toBe('');
    expect(r.emotion).toBe('无语');
  });

  it('认识角色时保留名字', () => {
    expect(parseQwenVision('角色：奶龙').character).toBe('奶龙');
  });

  it('不按格式时退化成第一行当情绪', () => {
    expect(parseQwenVision('一个无语的表情').emotion).toContain('无语');
  });

  it('去引号', () => {
    expect(parseQwenVision('情绪：“大笑”').emotion).toBe('大笑');
  });

  it('空输入返回全空', () => {
    const r = parseQwenVision('');
    expect(r.text).toBe('');
    expect(r.character).toBe('');
  });
});

describe('isQuotaOrAuthError', () => {
  it('401/403/429 算额度或权限问题', () => {
    expect(isQuotaOrAuthError(401, '')).toBe(true);
    expect(isQuotaOrAuthError(403, '')).toBe(true);
    expect(isQuotaOrAuthError(429, '')).toBe(true);
  });

  it('正文含额度关键词也算', () => {
    expect(isQuotaOrAuthError(400, 'Arrearage: 账户欠费')).toBe(true);
    expect(isQuotaOrAuthError(400, 'Throttling.User')).toBe(true);
    expect(isQuotaOrAuthError(400, 'InvalidApiKey')).toBe(true);
  });

  it('普通 400 不算', () => {
    expect(isQuotaOrAuthError(400, 'bad image format')).toBe(false);
  });

  it('5xx 不算（该重试不该降级）', () => {
    expect(isQuotaOrAuthError(500, 'internal')).toBe(false);
  });
});

describe('describeWithQwen', () => {
  const okFetch = (content: string) =>
    (async () => ({ ok: true, json: async () => ({ choices: [{ message: { content } }] }) } as any)) as unknown as typeof fetch;

  it('成功时返回解析结果', async () => {
    const r = await describeWithQwen('AAA', 'image/png', {
      apiKey: 'k', fetchImpl: okFetch('文字：\n情绪：无语\n角色：不确定'),
    });
    expect(r?.emotion).toBe('无语');
    expect(r?.character).toBe('');
  });

  it('无 key 返回 null', async () => {
    expect(await describeWithQwen('AAA', 'image/png', { apiKey: '' })).toBeNull();
  });

  it('HTTP 错误返回 null（由调用方降级）', async () => {
    const bad = (async () => ({ ok: false, status: 429 } as any)) as unknown as typeof fetch;
    expect(await describeWithQwen('AAA', 'image/png', { apiKey: 'k', fetchImpl: bad })).toBeNull();
  });

  it('网络异常返回 null', async () => {
    const boom = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    expect(await describeWithQwen('AAA', 'image/png', { apiKey: 'k', fetchImpl: boom })).toBeNull();
  });

  it('返回空内容返回 null', async () => {
    expect(await describeWithQwen('AAA', 'image/png', { apiKey: 'k', fetchImpl: okFetch('   ') })).toBeNull();
  });
});

describe('describeWithLocalVlm', () => {
  it('服务不可达返回空串', async () => {
    const boom = (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
    expect(await describeWithLocalVlm('AAA', { fetchImpl: boom })).toBe('');
  });

  it('endpoint 为空直接跳过', async () => {
    let called = false;
    const fake = (async () => { called = true; return { ok: true, json: async () => ({}) } as any; }) as unknown as typeof fetch;
    expect(await describeWithLocalVlm('AAA', { localVlmEndpoint: '', fetchImpl: fake })).toBe('');
    expect(called).toBe(false);
  });

  it('成功返回描述', async () => {
    const ok = (async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '委屈巴巴' } }] }) } as any)) as unknown as typeof fetch;
    expect(await describeWithLocalVlm('AAA', { fetchImpl: ok })).toBe('委屈巴巴');
  });
});
