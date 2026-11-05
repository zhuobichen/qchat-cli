import { describe, it, expect, vi } from 'vitest';
import { handleMessage, TOOLS, type McpBackend } from './mcp-server.js';

function makeBackend(): McpBackend {
  return {
    search: vi.fn(async () => [{ id: '1', text: '明天开会' }]),
    digest: vi.fn(async () => ({ total: 3, participants: 2 })),
    listGroups: vi.fn(async () => [{ group_id: 100, group_name: '测试群' }]),
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
    expect(tools.map((t) => t.name)).toEqual(['search_messages', 'group_digest', 'list_groups']);
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
