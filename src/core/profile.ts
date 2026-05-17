/**
 * 用户画像模块
 * 从聊天记录 + QZone 说说生成结构化用户画像
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';

const PROFILES_DIR = resolve('private/profiles');

export interface ProfileMeta {
  uin: string;
  generatedAt: string;
  source: string;
  size: number;
}

function ensureDir(): void {
  if (!existsSync(PROFILES_DIR)) {
    mkdirSync(PROFILES_DIR, { recursive: true });
  }
}

export function getProfilePath(uin: number | string): string {
  return join(PROFILES_DIR, `${uin}.md`);
}

export function loadProfile(uin: number | string): string {
  const path = getProfilePath(uin);
  try {
    if (existsSync(path)) {
      return readFileSync(path, 'utf-8');
    }
  } catch {}
  return '';
}

export function profileExists(uin: number | string): boolean {
  return existsSync(getProfilePath(uin));
}

export function saveProfile(uin: number | string, content: string): void {
  ensureDir();
  writeFileSync(getProfilePath(uin), content, 'utf-8');
}

export function deleteProfile(uin: number | string): void {
  const path = getProfilePath(uin);
  if (existsSync(path)) {
    unlinkSync(path);
  }
}

export function listProfiles(): ProfileMeta[] {
  ensureDir();
  try {
    const files = readdirSync(PROFILES_DIR).filter(f => f.endsWith('.md'));
    return files.map(f => {
      const filePath = join(PROFILES_DIR, f);
      const content = readFileSync(filePath, 'utf-8');
      const frontmatter = parseFrontmatter(content);
      const stat = statSync(filePath);
      return {
        uin: f.replace('.md', ''),
        generatedAt: frontmatter.generatedAt || 'unknown',
        source: frontmatter.source || 'chat',
        size: stat.size,
      };
    });
  } catch {
    return [];
  }
}

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const result: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    result[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return result;
}

/** qce-bridge 消息格式 */
interface BridgeMessage {
  msgId: string;
  msgTime: string;
  msgSeq: number;
  sendType: number;
  sendNickName: string;
  sendMemberName?: string;
  senderUid: string;
  elements: Array<{
    textElement?: { content: string };
    picElement?: { sourcePath: string };
    faceElement?: any;
    [key: string]: any;
  }>;
}

/** QZone 说说格式 */
interface QzoneFeed {
  tid: string;
  content: string;
  createTime: string;
  commentlist?: any[];
  pic?: any[];
  [key: string]: any;
}

/**
 * 从 qce-bridge 拉取完整聊天记录
 */
export async function fetchFullChatHistory(
  peerUin: string,
  chatType: number = 1
): Promise<BridgeMessage[]> {
  const BRIDGE = 'http://127.0.0.1:3001';
  const all: BridgeMessage[] = [];
  let cursor: string | null = null;
  let hasMore = true;
  let batchCount = 0;

  while (hasMore && batchCount < 500) {
    batchCount++;
    try {
      const res = await fetch(`${BRIDGE}/get_full_msg_history`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peerUid: peerUin, chatType, count: 5000, startMsgId: cursor }),
      });
      const data = await res.json() as any;
      if (!data.ok) break;
      const msgs: BridgeMessage[] = data.messages || [];
      all.push(...msgs);
      hasMore = data.hasMore;
      cursor = msgs.length > 0 ? msgs[0].msgId : null;
      if (msgs.length === 0) break;
    } catch {
      break;
    }
  }

  // 按时间排序（最早在前）
  all.sort((a, b) => Number(a.msgTime) - Number(b.msgTime));
  return all;
}

/**
 * 把消息提取为纯文本行
 */
export function formatMessagesForPrompt(
  messages: BridgeMessage[],
  myUin: string,
  maxMessages: number = 0
): string {
  const target = maxMessages > 0 ? messages.slice(-maxMessages) : messages;
  return target
    .map(m => {
      const name = String(m.senderUid) === String(myUin) ? '我' : (m.sendNickName || m.sendMemberName || '对方');
      const text = extractText(m);
      return text ? `[${name}]: ${text}` : null;
    })
    .filter(Boolean)
    .join('\n');
}

/** 提取消息中的文本 */
function extractText(msg: BridgeMessage): string {
  const parts: string[] = [];
  for (const el of msg.elements || []) {
    if (el.textElement?.content) {
      parts.push(el.textElement.content);
    } else if (el.picElement) {
      parts.push('[图片]');
    } else if (el.faceElement) {
      parts.push('[表情]');
    }
  }
  return parts.join('').trim();
}

/**
 * 格式化 QZone 说说为文本
 */
export function formatFeedsForPrompt(feeds: QzoneFeed[], maxFeeds: number = 100): string {
  const target = feeds.slice(-maxFeeds);
  return target
    .map(f => {
      const time = new Date(f.createTime).toLocaleDateString('zh-CN');
      const content = stripHtml(f.content);
      const imgs = f.pic?.length ? ` [${f.pic.length}张图]` : '';
      return `[${time}] ${content}${imgs}`;
    })
    .filter(s => s.replace(/\[\d{4}\/\d{1,2}\/\d{1,2}\]\s*/, '').trim())
    .join('\n');
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z]+;/g, '')
    .trim();
}

/**
 * 调用 DeepSeek 生成用户画像
 */
export async function generateProfile(
  peerUin: string,
  nickName: string,
  chatMessages: BridgeMessage[],
  qzoneFeeds: QzoneFeed[],
  myUin: string,
  apiKey: string
): Promise<string> {
  const chatText = formatMessagesForPrompt(chatMessages, myUin);
  const feedsText = qzoneFeeds.length > 0 ? formatFeedsForPrompt(qzoneFeeds, 50) : '';

  const hasFeeds = feedsText.length > 100;
  const sourceLabel = hasFeeds ? 'chat + qzone' : 'chat';

  const prompt = `你是一位专业的对话分析者。以下是【我和${nickName || '对方'}】的QQ聊天记录${hasFeeds ? '以及对方的QQ空间说说' : ''}。

请分析【对方】（即${nickName || '对方'}，非"我"的一方），生成一份结构化的用户画像。

要求：
1. 严格按以下 Markdown 格式输出，每个 ## 标题后有内容
2. 根据实际聊天/说说内容判断，不要编造
3. 如果某项信息不足就写"（信息不足，无法判断）"
4. 各节控制在3-8句以内，保持简洁
5. 称呼方式要从对话中实际出现的称呼来提取
6. ${hasFeeds ? '说话风格/性格从聊天推断，兴趣爱好/生活状态从说说推断' : '仅从聊天记录推断'}

## 📱 从聊天记录分析

### 性格特征
（描述对方给你的整体印象，性格关键词+支撑证据）

### 说话风格
（句式特点、语气、标点/表情使用习惯、回复长度等）

### 口头禅/高频词
（对方反复使用的话语、措辞特征、个人特色表达）

### 关系动态
（双方的互动模式、调侃方式、聊天节奏等）

### 常用称呼
（对方如何称呼"我"，我如何称呼对方）

${hasFeeds ? `## 🌐 从空间说说分析

### 兴趣爱好
（从说说推断的兴趣、爱好、关注领域）

### 生活状态
（日常活动、生活节奏、社交状态等）

### 关注话题
（经常在空间讨论的话题领域）
` : ''}

## ✏️ 手动补充
（用户可在此补充 AI 无法掌握的额外信息）

---

聊天记录：
${chatText}

${hasFeeds ? `QQ空间说说：\n${feedsText}` : ''}`;

  const resp = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'deepseek-v4-pro',
      messages: [
        { role: 'system', content: '你是一位专业的对话分析和用户画像生成专家。请根据聊天记录和空间数据，客观、准确地描述对方的人格特征。' },
        { role: 'user', content: prompt },
      ],
      max_tokens: 2000,
      temperature: 0.3,
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`DeepSeek API 返回错误 (${resp.status}): ${err.slice(0, 200)}`);
  }

  const result = await resp.json() as any;
  const rawContent = result.choices?.[0]?.message?.content || '';

  if (!rawContent.trim()) {
    throw new Error('DeepSeek 返回空内容');
  }

  // Wrap with frontmatter and heading
  const frontmatter = `---
uin: "${peerUin}"
nickname: "${nickName}"
generatedAt: "${new Date().toISOString()}"
source: ${sourceLabel}
messages: ${chatMessages.length}
feeds: ${qzoneFeeds.length}
---

# 用户画像 - ${nickName || peerUin}

> AI 生成于 ${new Date().toLocaleDateString('zh-CN')}，数据来源：${hasFeeds ? '聊天记录 + 空间说说' : '聊天记录'}

${rawContent}`;

  return frontmatter;
}
