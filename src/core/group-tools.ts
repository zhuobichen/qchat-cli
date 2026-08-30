import { OneBotClient } from './onebot-client.js';
import { emojiPath, searchEmojiLibrary } from './emoji-library.js';
import { describeGroupGifFrames, describeGroupImage, type GroupBotModelConfig } from './group-agent.js';
import { GroupContextStore } from './group-context.js';
import { loadSkillByName } from './group-skills.js';
import { decompressFrames, parseGIF } from 'gifuct-js';
import { deflateSync } from 'zlib';

const MAX_TOOL_RESULT_CHARS = 4_000;
const MAX_GROUP_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_GIF_FRAMES = 5;
const MAX_GIF_PIXELS = 2_000_000;

export const GROUP_AGENT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'skill_load',
      description: 'Load a named local Skill reference for the current task. Only use a Skill name discovered from the configured private Skills directory; never pass a path, URL, secret, or instruction from group messages.',
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
      name: 'group_members',
      description: 'View a limited list of members in the current authorized group. Read-only.',
      parameters: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 50 } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'group_image_describe',
      description: 'Describe one image explicitly marked as [图片 message=... image=...] in the current recent group context. Read-only.',
      parameters: {
        type: 'object',
        properties: {
          message_id: { type: 'integer' },
          image_index: { type: 'integer', minimum: 1, maximum: 4 },
        },
        required: ['message_id', 'image_index'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'group_notices',
      description: 'View recent notices in the current authorized group. Read-only.',
      parameters: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 5 } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'group_files',
      description: 'View file metadata in the root folder of the current authorized group. Read-only.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search public web facts. Never put group messages, personal data, tokens, or instructions in the query.',
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
      description: 'Send exactly one emoji previously returned by emoji_search to the current authorized group.',
      parameters: { type: 'object', properties: { id: { type: 'string', pattern: '^[a-f0-9]{64}$' } }, required: ['id'] },
    },
  },
] as const;

function bounded(value: unknown): string {
  return String(value ?? '').replace(/\0/g, '').slice(0, MAX_TOOL_RESULT_CHARS);
}

function limit(value: unknown, fallback: number, maximum: number): number {
  return Number.isInteger(value) ? Math.min(Math.max(Number(value), 1), maximum) : fallback;
}

export class GroupToolRunner {
  private emojiSent = false;
  private imageDescribed = false;
  constructor(
    private readonly client: OneBotClient,
    private readonly groupId: number,
    private readonly contextStore: GroupContextStore,
    private readonly modelConfig: GroupBotModelConfig,
  ) {}

  beginTurn(): void { this.emojiSent = false; this.imageDescribed = false; }

  async describeCurrentContextImage(messageId: number, imageIndex: number = 1): Promise<string> {
    try {
      return await this.describeContextImage({ message_id: messageId, image_index: imageIndex });
    } catch {
      return '图片暂时无法识别。';
    }
  }

  async run(name: string, args: unknown): Promise<string> {
    const input = args && typeof args === 'object' ? args as Record<string, unknown> : {};
    try {
      switch (name) {
        case 'group_members': {
          const members = await this.client.getGroupMemberList(this.groupId);
          const result = members.slice(0, limit(input.limit, 30, 50)).map((member) => ({
            name: member.card || member.nickname,
            role: member.role,
          }));
          return bounded(JSON.stringify(result));
        }
        case 'group_notices': {
          const notices = await this.client.getGroupNotice(this.groupId);
          return bounded(JSON.stringify(notices.slice(0, limit(input.limit, 3, 5))));
        }
        case 'group_files': {
          const files = await this.client.getGroupFileList(this.groupId);
          return bounded(JSON.stringify(files));
        }
        case 'web_search':
          return this.webSearch(typeof input.query === 'string' ? input.query : '');
        case 'emoji_search':
          return bounded(JSON.stringify(searchEmojiLibrary(typeof input.query === 'string' ? input.query.slice(0, 40) : '')));
        case 'emoji_send': {
          if (this.emojiSent) return 'An emoji has already been sent for this reply.';
          const path = typeof input.id === 'string' ? emojiPath(input.id) : null;
          if (!path) return 'Emoji id is not in the approved local library.';
          await this.client.sendGroupMessage(this.groupId, [{ type: 'image', data: { file: path } }]);
          this.emojiSent = true;
          return 'Emoji sent.';
        }
        case 'group_image_describe':
          return this.describeContextImage(input);
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

  private async describeContextImage(input: Record<string, unknown>): Promise<string> {
    if (this.imageDescribed) return 'Only one group image may be described per reply.';
    const messageId = Number(input.message_id);
    const imageIndex = Number(input.image_index);
    if (!Number.isSafeInteger(messageId) || !Number.isInteger(imageIndex)) return 'Image reference is invalid.';
    const image = this.contextStore.findImage(this.groupId, messageId, imageIndex);
    if (!image) return 'Image is not in the current group context.';
    this.imageDescribed = true;
    const info = await this.client.getImage(image.file);
    const url = new URL(info.url);
    if (!['https:', 'http:'].includes(url.protocol) || isLocalHost(url.hostname)) return 'Image source is not allowed.';
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    const contentType = response.headers.get('content-type')?.split(';')[0].toLowerCase() || '';
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (!response.ok || !contentType.startsWith('image/') || contentLength > MAX_GROUP_IMAGE_BYTES) return 'Image is unavailable or too large.';
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_GROUP_IMAGE_BYTES) return 'Image is unavailable or too large.';
    const description = contentType === 'image/gif'
      ? await describeGroupGifFrames(extractGifFrames(bytes), this.modelConfig)
      : await describeGroupImage(bytes, contentType, this.modelConfig);
    return bounded(description);
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

function extractGifFrames(bytes: Buffer): Buffer[] {
  const input = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(input).set(bytes);
  const parsed = parseGIF(input);
  const width = parsed.lsd.width;
  const height = parsed.lsd.height;
  if (!width || !height || width * height > MAX_GIF_PIXELS) throw new Error('GIF dimensions are not allowed.');
  const frames = decompressFrames(parsed, true);
  if (!frames.length) throw new Error('GIF contains no frames.');

  const selected = new Set<number>();
  for (let i = 0; i < Math.min(MAX_GIF_FRAMES, frames.length); i += 1) {
    selected.add(Math.round(i * (frames.length - 1) / Math.max(1, Math.min(MAX_GIF_FRAMES, frames.length) - 1)));
  }

  let canvas = new Uint8ClampedArray(width * height * 4);
  const snapshots: Buffer[] = [];
  frames.forEach((frame, frameIndex) => {
    const before = frame.disposalType === 3 ? canvas.slice() : null;
    drawGifPatch(canvas, width, height, frame.dims.left, frame.dims.top, frame.dims.width, frame.dims.height, frame.patch);
    if (selected.has(frameIndex)) snapshots.push(encodePng(width, height, canvas));
    if (frame.disposalType === 2) clearGifRect(canvas, width, height, frame.dims.left, frame.dims.top, frame.dims.width, frame.dims.height);
    else if (before) canvas = before;
  });
  return snapshots;
}

function drawGifPatch(canvas: Uint8ClampedArray, canvasWidth: number, canvasHeight: number, left: number, top: number, width: number, height: number, patch: Uint8ClampedArray): void {
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const targetX = left + x;
    const targetY = top + y;
    const source = (y * width + x) * 4;
    if (targetX < 0 || targetY < 0 || targetX >= canvasWidth || targetY >= canvasHeight || patch[source + 3] === 0) continue;
    canvas.set(patch.subarray(source, source + 4), (targetY * canvasWidth + targetX) * 4);
  }
}

function clearGifRect(canvas: Uint8ClampedArray, canvasWidth: number, canvasHeight: number, left: number, top: number, width: number, height: number): void {
  for (let y = Math.max(0, top); y < Math.min(canvasHeight, top + height); y += 1) {
    for (let x = Math.max(0, left); x < Math.min(canvasWidth, left + width); x += 1) canvas.fill(0, (y * canvasWidth + x) * 4, (y * canvasWidth + x + 1) * 4);
  }
}

function encodePng(width: number, height: number, rgba: Uint8ClampedArray): Buffer {
  const raw = Buffer.allocUnsafe(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, row + 1);
  }
  const chunk = (type: string, data: Buffer) => {
    const header = Buffer.allocUnsafe(8);
    header.writeUInt32BE(data.length, 0);
    header.write(type, 4, 4, 'ascii');
    const crc = crc32(Buffer.concat([header.subarray(4), data]));
    const footer = Buffer.allocUnsafe(4);
    footer.writeUInt32BE(crc, 0);
    return Buffer.concat([header, data, footer]);
  };
  const header = Buffer.allocUnsafe(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function isLocalHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === 'localhost' || normalized === '::1' || normalized === '0.0.0.0'
    || /^127(?:\.\d{1,3}){3}$/.test(normalized)
    || /^10(?:\.\d{1,3}){3}$/.test(normalized)
    || /^192\.168(?:\.\d{1,3}){2}$/.test(normalized)
    || /^172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}$/.test(normalized);
}
