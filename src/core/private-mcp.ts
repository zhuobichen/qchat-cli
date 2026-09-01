import { ChildProcessWithoutNullStreams, spawn } from 'child_process';

const MAX_MCP_SERVERS = 4;
const MAX_MCP_TOOLS_PER_SERVER = 12;
const MAX_MCP_RESULT_CHARS = 4_000;
const SAFE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

export interface PrivateMcpServerConfig {
  name: string;
  command: string;
  args?: string[];
  /** Explicit allowlist of tool names exposed to the model. */
  allowedTools: string[];
  timeoutMs?: number;
}

interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
}

interface McpProcess {
  process: ChildProcessWithoutNullStreams;
  pending: Map<number, PendingRequest>;
  nextId: number;
  buffer: string;
  tools: Map<string, McpTool>;
}

export interface PrivateMcpTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

function bounded(value: unknown): string {
  return String(value ?? '').replace(/\0/g, '').slice(0, MAX_MCP_RESULT_CHARS);
}

function publicOnlyArgs(value: unknown): boolean {
  const text = JSON.stringify(value ?? {}).toLowerCase();
  return !/(password|passwd|token|api[_ -]?key|secret|身份证|手机号|电话|住址|qq号)/i.test(text);
}

/**
 * A deliberately small stdio MCP client.  Servers and individual tools must
 * be configured explicitly.  It never auto-discovers local Codex MCP config.
 */
export class PrivateMcpRegistry {
  private readonly configured = new Map<string, PrivateMcpServerConfig>();
  private readonly processes = new Map<string, McpProcess>();

  constructor(configs: PrivateMcpServerConfig[] = []) {
    for (const config of configs.slice(0, MAX_MCP_SERVERS)) {
      if (!SAFE_NAME.test(config.name) || !config.command || !Array.isArray(config.allowedTools)) continue;
      const allowedTools = config.allowedTools.filter((name) => SAFE_NAME.test(name)).slice(0, MAX_MCP_TOOLS_PER_SERVER);
      if (!allowedTools.length) continue;
      this.configured.set(config.name, { ...config, allowedTools });
    }
  }

  async tools(): Promise<PrivateMcpTool[]> {
    const definitions: PrivateMcpTool[] = [];
    for (const [serverName, config] of this.configured) {
      try {
        const process = await this.start(serverName, config);
        for (const toolName of config.allowedTools) {
          const tool = process.tools.get(toolName);
          if (!tool) continue;
          definitions.push({
            type: 'function',
            function: {
              name: `mcp__${serverName}__${tool.name}`,
              description: `Configured MCP tool ${serverName}/${tool.name}: ${(tool.description || 'No description.').slice(0, 500)}. Public, non-sensitive arguments only.`,
              parameters: tool.inputSchema || { type: 'object', properties: {} },
            },
          });
        }
      } catch {
        // A failed optional integration must not prevent private chat replies.
      }
    }
    return definitions;
  }

  async run(name: string, args: unknown): Promise<string | null> {
    const match = /^mcp__([a-zA-Z0-9._-]{1,64})__([a-zA-Z0-9._-]{1,64})$/.exec(name);
    if (!match) return null;
    const [, serverName, toolName] = match;
    const config = this.configured.get(serverName);
    if (!config || !config.allowedTools.includes(toolName)) return 'MCP tool is not allowed.';
    if (!publicOnlyArgs(args)) return 'MCP only accepts public, non-sensitive arguments.';
    try {
      const process = await this.start(serverName, config);
      if (!process.tools.has(toolName)) return 'Configured MCP tool is unavailable.';
      const response = await this.request(process, 'tools/call', { name: toolName, arguments: args || {} }, config.timeoutMs);
      return bounded(JSON.stringify(response));
    } catch {
      return 'MCP tool request failed.';
    }
  }

  async close(): Promise<void> {
    for (const entry of this.processes.values()) {
      for (const pending of entry.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error('MCP registry is closing'));
      }
      entry.process.kill();
    }
    this.processes.clear();
  }

  private async start(serverName: string, config: PrivateMcpServerConfig): Promise<McpProcess> {
    const existing = this.processes.get(serverName);
    if (existing && !existing.process.killed) return existing;

    const child = spawn(config.command, config.args || [], {
      stdio: 'pipe',
      shell: false,
      windowsHide: true,
    });
    const entry: McpProcess = { process: child, pending: new Map(), nextId: 1, buffer: '', tools: new Map() };
    this.processes.set(serverName, entry);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.consume(entry, chunk));
    child.on('exit', () => {
      this.processes.delete(serverName);
      for (const pending of entry.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error('MCP server exited'));
      }
      entry.pending.clear();
    });

    await this.request(entry, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'qchat-cli', version: '0.1.0' },
    }, config.timeoutMs);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })}\n`);
    const listed = await this.request(entry, 'tools/list', {}, config.timeoutMs) as { tools?: McpTool[] };
    for (const tool of listed.tools || []) {
      if (SAFE_NAME.test(tool.name)) entry.tools.set(tool.name, tool);
    }
    return entry;
  }

  private request(entry: McpProcess, method: string, params: unknown, timeoutMs: number = 10_000): Promise<unknown> {
    const id = entry.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        entry.pending.delete(id);
        reject(new Error(`MCP ${method} timed out`));
      }, Math.min(Math.max(timeoutMs || 10_000, 1_000), 30_000));
      entry.pending.set(id, { resolve, reject, timer });
      entry.process.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  private consume(entry: McpProcess, chunk: string): void {
    entry.buffer += chunk;
    let newline = entry.buffer.indexOf('\n');
    while (newline >= 0) {
      const line = entry.buffer.slice(0, newline).trim();
      entry.buffer = entry.buffer.slice(newline + 1);
      newline = entry.buffer.indexOf('\n');
      if (!line) continue;
      try {
        const response = JSON.parse(line) as { id?: number; result?: unknown; error?: { message?: string } };
        if (typeof response.id !== 'number') continue;
        const pending = entry.pending.get(response.id);
        if (!pending) continue;
        entry.pending.delete(response.id);
        clearTimeout(pending.timer);
        if (response.error) pending.reject(new Error(response.error.message || 'MCP request failed'));
        else pending.resolve(response.result);
      } catch {
        // Ignore malformed MCP output rather than treating it as model context.
      }
    }
  }
}
