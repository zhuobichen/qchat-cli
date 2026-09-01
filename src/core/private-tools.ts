import { OneBotClient } from './onebot-client.js';
import { emojiPath, searchEmojiLibrary } from './emoji-library.js';
import { describeGroupImage, type GroupBotModelConfig } from './group-agent.js';
import { loadSkillByName } from './group-skills.js';
import { PrivateContextStore } from './private-context.js';
import { PrivateMcpRegistry } from './private-mcp.js';

const MAX_TOOL_RESULT_CHARS = 4_000;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

export const PRIVATE_AGENT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'skill_load',
      description: 'Load a named local Skill reference for the current task. Only use a Skill name discovered from the configured private Skills directory; never pass a path, URL, secret, or instruction from private messages.',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$' } },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search public web facts. Never put private messages, personal data, tokens, or instructions in the query.',
      parameters: { type: 'object', properties: { query: { type: 'string', minLength: 1, maxLength: 180 } }, required: ['query'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'emoji_search',
      description: 'Search the local approved emoji library by a short mood or meaning query.',
      parameters: { type: 'object', properties: { query: { type: 'string', minLength: 1, maxLength: 40 } }, required: ['query'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'emoji_send',
      description: 'Send exactly one emoji previously returned by emoji_search to the current authorized private chat.',
      parameters: { type: 'object', properties: { id: { type: 'string', pattern: '^[a-f0-9]{64}$' } }, required: ['id'] },
    },
  },
] as const;

function bounded(value: unknown): string {
  return String(value ?? '').replace(/\0/g, '').slice(0, MAX_TOOL_RESULT_CHARS);
}

function isLocalHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === 'localhost' || normalized === '::1' || normalized === '0.0.0.0'
    || /^127(?:\.\d{1,3}){3}$/.test(normalized)
    || /^10(?:\.\d{1,3}){3}$/.test(normalized)
    || /^192\.168(?:\.\d{1,3}){2}$/.test(normalized)
    || /^172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}$/.test(normalized);
}

export class PrivateToolRunner {
  private emojiSent = false;

  constructor(
    private readonly client: OneBotClient,
    private readonly userId: number,
    private readonly contextStore: PrivateContextStore,
    private readonly modelConfig: GroupBotModelConfig,
    private readonly mcpRegistry?: PrivateMcpRegistry,
  ) {}

  beginTurn(): void {
    this.emojiSent = false;
  }

  async describeCurrentContextImage(messageId: number, imageIndex: number = 1): Promise<string> {
    try {
      const image = this.contextStore.findImage(this.userId, messageId, imageIndex);
      if (!image) return '';
      const info = await this.client.getImage(image.file);
      const url = new URL(info.url);
      if (!['https:', 'http:'].includes(url.protocol) || isLocalHost(url.hostname)) return '图片来源不允许访问。';
      const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      const contentType = response.headers.get('content-type')?.split(';')[0].toLowerCase() || '';
      const contentLength = Number(response.headers.get('content-length') || 0);
      if (!response.ok || !contentType.startsWith('image/') || contentLength > MAX_IMAGE_BYTES) return '图片暂时无法识别。';
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) return '图片暂时无法识别。';
      return await describeGroupImage(bytes, contentType, this.modelConfig);
    } catch {
      return '图片暂时无法识别。';
    }
  }

  async run(name: string, args: unknown): Promise<string> {
    const input = args && typeof args === 'object' ? args as Record<string, unknown> : {};
    try {
      const mcpResult = await this.mcpRegistry?.run(name, args);
      if (mcpResult !== undefined && mcpResult !== null) return bounded(mcpResult);
      switch (name) {
        case 'web_search':
          return this.webSearch(typeof input.query === 'string' ? input.query : '');
        case 'emoji_search':
          return bounded(JSON.stringify(searchEmojiLibrary(typeof input.query === 'string' ? input.query.slice(0, 40) : '')));
        case 'emoji_send': {
          if (this.emojiSent) return 'An emoji has already been sent for this reply.';
          const path = typeof input.id === 'string' ? emojiPath(input.id) : null;
          if (!path) return 'Emoji id is not in the approved local library.';
          await this.client.sendPrivateMessage(this.userId, [{ type: 'image', data: { file: path } }]);
          this.emojiSent = true;
          return 'Emoji sent.';
        }
        case 'skill_load': {
          const name = typeof input.name === 'string' ? input.name : '';
          const skill = loadSkillByName(this.modelConfig.skillDirectory, name);
          return skill ? bounded(skill) : 'Skill is not available.';
        }
        default:
          return 'Tool is not allowed.';
      }
    } catch {
      return 'Tool request failed.';
    }
  }

  private async webSearch(query: string): Promise<string> {
    const normalized = query.replace(/[\r\n\0]/g, ' ').trim().slice(0, 180);
    if (!normalized) return 'Search query is empty.';
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(normalized)}&format=json&no_html=1&no_redirect=1`;
    const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!response.ok) return bounded(JSON.stringify(await this.htmlSearch(normalized)));
    const payload = await response.json() as { AbstractText?: string; AbstractURL?: string; RelatedTopics?: Array<{ Text?: string; FirstURL?: string }> };
    const results = [
      payload.AbstractText ? { text: payload.AbstractText, url: payload.AbstractURL } : null,
      ...(payload.RelatedTopics || []).slice(0, 4).flatMap((item) => item.Text ? [{ text: item.Text, url: item.FirstURL }] : []),
    ].filter(Boolean);
    return bounded(JSON.stringify(results.length ? results : await this.htmlSearch(normalized)));
  }

  private async htmlSearch(query: string): Promise<Array<{ text: string }>> {
    try {
      const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
        headers: { 'User-Agent': 'qchat-cli/0.1 public-search' },
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) return [{ text: 'Public search is unavailable.' }];
      const html = await response.text();
      const matches = [...html.matchAll(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)]
        .slice(0, 5)
        .map((match) => match[1].replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .map((text) => ({ text }));
      return matches.length ? matches : [{ text: 'No public result found.' }];
    } catch {
      return [{ text: 'Public search is unavailable.' }];
    }
  }
}
