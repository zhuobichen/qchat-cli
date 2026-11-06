import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleMessage, TOOLS, __clearPending, type McpBackend } from './mcp-server.js';

function makeBackend(): McpBackend {
  return {
    search: vi.fn(async () => [{ id: '1', text: '明天开会' }]),
    digest: vi.fn(async () => ({ total: 3, participants: 2 })),
    listGroups: vi.fn(async () => [{ group_id: 100, group_name: '测试群' }]),
    send: vi.fn(async () => ({ ok: true })),
    pickSticker: vi.fn(async ({ stickerId }: any) => ({ id: stickerId ?? 'a'.repeat(64), label: '测试表情', source: stickerId ? 'explicit' : 'jev' })),
    sendSticker: vi.fn(async () => ({ ok: true })),
  };
}

describe('MCP server', () => {
  it('initialize 返回协议版本与服务信息', async () => {
    const res = await handleMessage(makeBackend(), { jsonrpc: '2.0', id: 1, method: 'initialize' });
    expect(res?.result).toMatchObject({
      protocolVersion: '2024-11-05',
      serverInfo: { name: 'qchat-cli' },
    });
  });

  it('tools/list 暴露三个工具且带 inputSchema', async () => {
    const res = await handleMessage(makeBackend(), { jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const tools = (res?.result as { tools: typeof TOOLS }).tools;
    expect(tools.map((t) => t.name)).toEqual(['search_messages', 'group_digest', 'list_groups', 'send_sticker', 'send_message']);
    for (const t of tools) expect(t.inputSchema).toBeTypeOf('object');
  });

  it('tools/call search_messages 调用后端并返回文本内容', async () => {
    const backend = makeBackend();
    const res = await handleMessage(backend, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'search_messages', arguments: { query: '开会', groupId: 100 } },
    });
    expect(backend.search).toHaveBeenCalledWith({ query: '开会', groupId: 100, limit: undefined, since: undefined });
    const content = (res?.result as any).content;
    expect(content[0].type).toBe('text');
    expect(content[0].text).toContain('明天开会');
  });

  it('search_messages 缺 query 时返回错误内容', async () => {
    const res = await handleMessage(makeBackend(), {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'search_messages', arguments: {} },
    });
    expect((res?.result as any).isError).toBe(true);
  });

  it('group_digest 参数校验', async () => {
    const res = await handleMessage(makeBackend(), {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'group_digest', arguments: {} },
    });
    expect((res?.result as any).isError).toBe(true);
  });

  it('后端抛错时转为 isError 而不是崩掉', async () => {
    const backend = makeBackend();
    (backend.search as any).mockRejectedValueOnce(new Error('OneBot 不可用'));
    const res = await handleMessage(backend, {
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: { name: 'search_messages', arguments: { query: 'x' } },
    });
    expect((res?.result as any).isError).toBe(true);
    expect((res?.result as any).content[0].text).toContain('OneBot 不可用');
  });

  it('未知工具返回 -32602', async () => {
    const res = await handleMessage(makeBackend(), {
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: { name: 'nope', arguments: {} },
    });
    expect(res?.error?.code).toBe(-32602);
  });

  it('未知方法返回 -32601', async () => {
    const res = await handleMessage(makeBackend(), { jsonrpc: '2.0', id: 8, method: 'resources/list' });
    expect(res?.error?.code).toBe(-32601);
  });

  it('通知不应回包', async () => {
    const res = await handleMessage(makeBackend(), { jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(res).toBeNull();
  });

  it('ping 返回空结果', async () => {
    const res = await handleMessage(makeBackend(), { jsonrpc: '2.0', id: 9, method: 'ping' });
    expect(res?.result).toEqual({});
  });
});

describe('send_message（两阶段确认）', () => {
  const callWith = (backend: McpBackend, args: any, options: any = {}) =>
    handleMessage(backend, {
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'send_message', arguments: args },
    }, options);
  const call = (args: any, options: any = {}) => callWith(makeBackend(), args, options);

  beforeEach(() => __clearPending());

  it('工具列表里有 send_message', async () => {
    const res = await handleMessage(makeBackend(), { jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const names = (res?.result as any).tools.map((t: any) => t.name);
    expect(names).toContain('send_message');
  });

  it('群发默认被拒', async () => {
    const backend = makeBackend();
    const res = await callWith(backend, { kind: 'group', target: 123, text: 'hi' });
    expect((res?.result as any).isError).toBe(true);
    expect((res?.result as any).content[0].text).toContain('群发已在服务端禁用');
    expect(backend.send).not.toHaveBeenCalled();
  });

  it('私聊第一次只返回令牌，不发送', async () => {
    const backend = makeBackend();
    const res = await callWith(backend, { kind: 'private', target: 10001000, text: '测试消息' });
    const text = (res?.result as any).content[0].text as string;
    expect(text).toContain('待确认');
    expect(text).toMatch(/ctk_/);
    expect(backend.send).not.toHaveBeenCalled();
  });

  it('带令牌第二次才真正发送', async () => {
    const backend = makeBackend();
    const first = await callWith(backend, { kind: 'private', target: 10001000, text: '测试消息' });
    const token = ((first?.result as any).content[0].text as string).match(/ctk_[A-Za-z0-9_]+/)?.[0];
    expect(token).toBeTruthy();
    const second = await callWith(backend, { kind: 'private', target: 10001000, text: '测试消息', confirmationToken: token });
    expect((second?.result as any).isError).toBeUndefined();
    expect(backend.send).toHaveBeenCalledWith({ kind: 'private', target: 10001000, text: '测试消息' });
  });

  it('令牌与内容不匹配时拒绝', async () => {
    const backend = makeBackend();
    const first = await callWith(backend, { kind: 'private', target: 10001000, text: '原文' });
    const token = ((first?.result as any).content[0].text as string).match(/ctk_[A-Za-z0-9_]+/)?.[0]!;
    const res = await callWith(backend, { kind: 'private', target: 10001000, text: '被篡改的内容', confirmationToken: token });
    expect((res?.result as any).isError).toBe(true);
    expect((res?.result as any).content[0].text).toContain('不匹配');
    expect(backend.send).not.toHaveBeenCalled();
  });

  it('过期令牌被拒', async () => {
    const backend = makeBackend();
    const first = await callWith(backend, { kind: 'private', target: 10001000, text: 'x' }, { tokenTtlMs: -1 });
    const token = ((first?.result as any).content[0].text as string).match(/ctk_[A-Za-z0-9_]+/)?.[0]!;
    const res = await callWith(backend, { kind: 'private', target: 10001000, text: 'x', confirmationToken: token });
    expect((res?.result as any).isError).toBe(true);
    expect(backend.send).not.toHaveBeenCalled();
  });

  it('缺参数时报错', async () => {
    expect(((await call({ target: 0, text: 'x' }))?.result as any).isError).toBe(true);
    expect(((await call({ target: 10001000, text: '  ' }))?.result as any).isError).toBe(true);
  });

  it('打开 allowGroupSend 后可发群', async () => {
    const backend = makeBackend();
    const first = await callWith(backend, { kind: 'group', target: 913807639, text: '群公告' }, { allowGroupSend: true });
    const token = ((first?.result as any).content[0].text as string).match(/ctk_[A-Za-z0-9_]+/)?.[0]!;
    const second = await callWith(backend, { kind: 'group', target: 913807639, text: '群公告', confirmationToken: token }, { allowGroupSend: true });
    expect((second?.result as any).isError).toBeUndefined();
    expect(backend.send).toHaveBeenCalledWith({ kind: 'group', target: 913807639, text: '群公告' });
  });
});

describe('send_sticker（两阶段确认 + Jev 选择）', () => {
  const callWith = (backend: McpBackend, args: any, options: any = {}) =>
    handleMessage(backend, {
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'send_sticker', arguments: args },
    }, options);

  beforeEach(() => __clearPending());

  it('群发默认被拒', async () => {
    const backend = makeBackend();
    const res = await callWith(backend, { kind: 'group', target: 913807639, intent: '庆祝' });
    expect((res?.result as any).isError).toBe(true);
    expect(backend.sendSticker).not.toHaveBeenCalled();
  });

  it('既没 intent 也没 stickerId 时报错', async () => {
    const res = await callWith(makeBackend(), { target: 10001000 });
    expect((res?.result as any).isError).toBe(true);
  });

  it('第一阶段选好表情、摘要里带 label，且不发送', async () => {
    const backend = makeBackend();
    const res = await callWith(backend, { target: 10001000, intent: '安慰一下' });
    const text = (res?.result as any).content[0].text as string;
    expect(text).toContain('待确认');
    expect(text).toContain('测试表情');
    expect(text).toMatch(/ctk_/);
    expect(backend.pickSticker).toHaveBeenCalledWith({ intent: '安慰一下' });
    expect(backend.sendSticker).not.toHaveBeenCalled();
  });

  it('带令牌第二阶段才真正发送', async () => {
    const backend = makeBackend();
    const first = await callWith(backend, { target: 10001000, intent: '庆祝' });
    const token = ((first?.result as any).content[0].text as string).match(/ctk_[A-Za-z0-9_]+/)?.[0];
    const second = await callWith(backend, { target: 10001000, intent: '庆祝', confirmationToken: token });
    expect((second?.result as any).isError).toBeUndefined();
    expect(backend.sendSticker).toHaveBeenCalledWith({
      kind: 'private', target: 10001000, stickerId: 'a'.repeat(64), label: '测试表情',
    });
  });

  it('pickSticker 抛错时返回错误内容', async () => {
    const backend = makeBackend();
    (backend.pickSticker as any).mockRejectedValueOnce(new Error('表情库为空'));
    const res = await callWith(backend, { target: 10001000, intent: 'x' });
    expect((res?.result as any).isError).toBe(true);
    expect((res?.result as any).content[0].text).toContain('表情库为空');
  });
});
