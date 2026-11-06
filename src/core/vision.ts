/**
 * 图像理解：千问优先，本地兜底。
 *
 * 为什么统一到这里：项目里原本有两条识图路径（group-agent 的 describeEmoji
 * 走 MaaS 端点的 qwen2.5-vl-7b；打标脚本走本地 llama.cpp）。
 * 两条各说各话，模型能力也不一致。这里收成一个入口。
 *
 * 优先级（用户定的）：
 *   1. 千问 qwen3-vl-plus（DashScope 直连）—— 认得准、不占显存、能和 TTS 同跑
 *   2. 本地 OCR（rapidocr，免费 CPU）—— 千问没额度/失败时，至少把图里的字提出来
 *   3. 本地视觉模型（llama.cpp :8081）—— 前两者都不行且服务在跑时才用
 *
 * 成本：千问约 0.003 元/张；本地两条都是 0。
 */
import { resolveApiKey } from './embeddings.js';
import { runOcr, defaultOcrScript, resolvePython } from './ocr.js';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

export const QWEN_VL_ENDPOINT =
  'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
export const QWEN_VL_MODEL = 'qwen3-vl-plus';

/** 本地 llama.cpp 视觉服务（vlm\启动识图.bat） */
export const LOCAL_VLM_ENDPOINT = 'http://127.0.0.1:8081/v1/chat/completions';

export interface ImageUnderstanding {
  /** 图里的文字（可能为空） */
  text: string;
  /** 情绪 / 使用场景 */
  emotion: string;
  /** 角色名（认不准就是空字符串，绝不硬猜） */
  character: string;
  /** 结果来自哪条路 */
  source: 'qwen' | 'local-ocr' | 'local-vlm' | 'none';
}

export interface UnderstandOptions {
  /** 跳过千问，强制走本地 */
  localOnly?: boolean;
  /** 跳过本地兜底（只看千问结果） */
  qwenOnly?: boolean;
  apiKey?: string;
  model?: string;
  endpoint?: string;
  /** 本地 VLM 地址；给空字符串表示不用 */
  localVlmEndpoint?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const PROMPT = [
  '这是一张聊天表情包。严格按下面三行格式回答，不要多余解释、不要引号：',
  '文字：（把图里出现的文字逐字抄下来，没有就留空）',
  '情绪：（不超过15个中文字，描述情绪或使用场景）',
  '角色：（明确认识这个卡通角色/IP 才写名字，不确定就写"不确定"）',
].join(String.fromCharCode(10));

/** 判断错误是不是"额度/权限"类——这类错误该降级而不是重试 */
export function isQuotaOrAuthError(status: number, body: string): boolean {
  if (status === 401 || status === 403 || status === 429) return true;
  const b = (body ?? '').toLowerCase();
  return /quota|throttl|arrearage|insufficient|余额|欠费|额度|未开通|access denied|invalid.?api.?key/.test(b);
}

/**
 * 清洗图里提取的文字：去掉 UI 噪音。
 *
 * 为什么需要：DeepSeek 那批表情带「已思考（用时 N 秒）＞」这种思考框，
 * 千问会老老实实把它当前缀抄下来（本地 OCR 那条路早就清过了）。
 */
export function cleanVisualText(raw: string): string {
  return String(raw ?? '')
    .replace(/已思考[^）)]*[）)]?/g, '')
    .replace(/用时\s*\d+(\.\d+)?\s*秒/g, '')
    .replace(/^[>＞\s·]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 解析千问的三行输出 */
export function parseQwenVision(raw: string): { text: string; emotion: string; character: string } {
  const src = String(raw ?? '');

  /**
   * 按「段落」取，而不是按行。
   *
   * 为什么：图里的文字经常是多行的（一张表情上有三四行台词），
   * 按行取只能拿到第一行，后面的全丢 —— 实测把
   * 「人物介绍 / GPT 拥有高中低档模型… / Claude 多方位SOTA…」截成了「人物介绍」。
   * 所以取「从 key 开始，到下一个 key 之前」的整段。
   */
  const section = (key: string): string => {
    const start = new RegExp(`${key}[:：]`).exec(src);
    if (!start) return '';
    const from = start.index + start[0].length;
    const rest = src.slice(from);
    const nextKey = /(文字|情绪|角色)[:：]/.exec(rest);
    const body = nextKey ? rest.slice(0, nextKey.index) : rest;
    return body.replace(/^[\s·>＞]+/, '').replace(/\s+$/g, '');
  };

  let text = section('文字');
  let emotion = section('情绪');
  let character = section('角色');

  // 模型偶尔不按格式来：退化成"第一行当情绪"
  if (!emotion && !text && !character) {
    emotion = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
  }
  // 把"不确定"归一成空
  if (/^(不确定|不知道|unknown|none|无)$/i.test(character)) character = '';
  // 空括号/空占位也归一
  if (/^(无|没有|none|-)$/i.test(text)) text = '';
  if (/^(无|没有|none|-)$/i.test(emotion)) emotion = '';

  const stripQuotes = (v: string) => v.replace(/^["'“”「」]|["'“”「」]$/g, '').trim();

  return {
    text: cleanVisualText(text).slice(0, 200),
    emotion: stripQuotes(emotion).slice(0, 40),
    character: stripQuotes(character).slice(0, 30),
  };
}

/** 千问识图；失败返回 null（由调用方降级） */
export async function describeWithQwen(
  imageBase64: string,
  mimeType: string,
  options: UnderstandOptions = {},
): Promise<{ text: string; emotion: string; character: string } | null> {
  const apiKey = options.apiKey ?? resolveApiKey();
  if (!apiKey) return null;

  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(options.endpoint ?? QWEN_VL_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: options.model ?? process.env.QCE_VL_MODEL ?? QWEN_VL_MODEL,
        max_tokens: 400,
        temperature: 0.1,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: PROMPT },
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
          ],
        }],
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 120_000),
    });
    if (!res.ok) return null;
    const json: any = await res.json();
    const raw = String(json?.choices?.[0]?.message?.content ?? '');
    if (!raw.trim()) return null;
    return parseQwenVision(raw);
  } catch {
    return null;
  }
}

/** 本地 OCR 提文字（免费）；失败返回空串 */
export function ocrLocal(file: string): string {
  try {
    const python = resolvePython();
    const script = defaultOcrScript();
    if (!existsSync(script)) return '';
    const r = runOcr([file], { python, script, timeoutMs: 60_000 });
    const t = cleanVisualText(r?.[0]?.text ?? '');
    return t.length >= 2 ? t : '';
  } catch {
    return '';
  }
}

/** 本地视觉模型（llama.cpp）；服务没起就直接放弃 */
export async function describeWithLocalVlm(
  imageBase64: string,
  options: UnderstandOptions = {},
): Promise<string> {
  const endpoint = options.localVlmEndpoint ?? LOCAL_VLM_ENDPOINT;
  if (!endpoint) return '';
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen3-vl',
        max_tokens: 60,
        temperature: 0.2,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: '用不超过15个中文字描述这张表情包的情绪或使用场景，只输出描述。' },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBase64}` } },
          ],
        }],
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 120_000),
    });
    if (!res.ok) return '';
    const json: any = await res.json();
    return String(json?.choices?.[0]?.message?.content ?? '').trim().slice(0, 40);
  } catch {
    return '';
  }
}

/**
 * 统一入口：千问 → 本地 OCR → 本地 VLM。
 *
 * @param file 本地图片路径（本地兜底要用）
 * @param pngBase64 统一转成 PNG 后的 base64（避免 webp/动图兼容问题）
 */
export async function understandImage(
  file: string,
  pngBase64: string,
  options: UnderstandOptions = {},
): Promise<ImageUnderstanding> {
  if (!options.localOnly) {
    const q = await describeWithQwen(pngBase64, 'image/png', options);
    if (q && (q.emotion || q.text)) {
      return { ...q, source: 'qwen' };
    }
  }

  if (options.qwenOnly) return { text: '', emotion: '', character: '', source: 'none' };

  // 兜底 1：本地 OCR 提字
  const ocr = ocrLocal(file);
  if (ocr) {
    return { text: ocr, emotion: ocr.slice(0, 40), character: '', source: 'local-ocr' };
  }

  // 兜底 2：本地视觉模型（服务没起会很快失败）
  const vlm = await describeWithLocalVlm(pngBase64, options);
  if (vlm) {
    return { text: '', emotion: vlm, character: '', source: 'local-vlm' };
  }

  return { text: '', emotion: '', character: '', source: 'none' };
}
