/**
 * 语音合成（TTS）：文字 → 音频文件，供 QQ 语音条发送。
 *
 * 用阿里云百炼 Qwen-TTS（OpenAI 风格的 multimodal-generation 端点）：
 *   POST /api/v1/services/aigc/multimodal-generation/generation
 *   { model: 'qwen3-tts-flash', input: { text, voice } }
 *   → output.audio.url（OSS 链接，24 小时有效）
 *
 * key 与语义检索共用 DASHSCOPE_API_KEY，不额外落盘。
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join as joinPath } from 'node:path';
import { join } from 'node:path';
import { resolveApiKey } from './embeddings.js';

export const TTS_ENDPOINT = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';
export const TTS_MODEL = 'qwen3-tts-flash';
export const TTS_VOICE = 'Cherry';

export interface TtsOptions {
  apiKey?: string;
  model?: string;
  voice?: string;
  endpoint?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface TtsResult {
  /** 远端音频地址（24h 有效） */
  url: string;
  /** 过期时间（秒） */
  expiresAt: number;
}

/** 从各家返回结构里取音频 URL（字段名可能不同，做个兜底） */
export function extractAudioUrl(payload: unknown): TtsResult | null {
  const out = (payload as any)?.output;
  const audio = out?.audio ?? out?.audio_url ?? out;
  const url = typeof audio === 'string' ? audio : audio?.url;
  if (typeof url !== 'string' || url === '') return null;
  const expiresAt = Number(audio?.expires_at ?? out?.expires_at ?? 0);
  return { url, expiresAt: Number.isFinite(expiresAt) ? expiresAt : 0 };
}

/** 合成语音，返回音频地址；失败返回 null（调用方决定提示） */
export async function synthesize(
  text: string,
  options: TtsOptions = {},
): Promise<TtsResult | null> {
  const trimmed = String(text ?? '').trim();
  if (trimmed === '') return null;

  const apiKey = options.apiKey ?? resolveApiKey();
  if (!apiKey) return null;

  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(options.endpoint ?? TTS_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: options.model ?? TTS_MODEL,
        input: { text: trimmed, voice: options.voice ?? TTS_VOICE },
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 60_000),
    });
    if (!res.ok) return null;
    return extractAudioUrl(await res.json());
  } catch {
    return null;
  }
}

/** 下载音频到本地目录，返回路径 */
export async function downloadAudio(
  url: string,
  dir: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  mkdirSync(dir, { recursive: true });
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok || !res.body) throw new Error(`下载音频失败 HTTP ${res.status}`);

  // 从响应头或 URL 推断扩展名，QQ 语音条常见 mp3/wav
  const ctype = String(res.headers.get('content-type') ?? '');
  const guess = url.split('?')[0].split('.').pop() ?? '';
  const ext = ctype.includes('wav') ? 'wav' : ctype.includes('mp3') || guess === 'mp3' ? 'mp3' : ctype.includes('ogg') ? 'ogg' : 'mp3';
  const file = join(dir, `tts-${Date.now()}.${ext}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(file, buf);
  return file;
}


/**
 * 找 ffmpeg：环境变量优先，其次 PATH，最后试仓库里 thirdparty 的副本。
 * 没找到返回空串（调用方退化：直接发原始 wav）。
 */
export function findFfmpeg(): string {
  if (process.env.QCE_FFMPEG) return process.env.QCE_FFMPEG;
  const probe = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
  if (probe.status === 0) return 'ffmpeg';
  return '';
}

/**
 * 转成 QQ 语音条能接受的格式。
 * QQ/NapCat 对 wav 支持不好（实测报"语音转换失败"），AMR-NB 最稳，其次 mp3。
 */
export function toVoiceFormat(
  input: string,
  ffmpeg: string,
  outDir: string,
): { file: string; format: 'amr' | 'mp3' | 'wav' } {
  if (!ffmpeg) return { file: input, format: 'wav' };
  mkdirSync(outDir, { recursive: true });
  const base = joinPath(outDir, `voice-${Date.now()}`);

  const amr = `${base}.amr`;
  const r1 = spawnSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', input,
    '-ar', '8000', '-ac', '1', '-c:a', 'libopencore_amrnb', '-b:a', '12.2k', amr,
  ], { encoding: 'utf8' });
  if (r1.status === 0 && existsSync(amr)) return { file: amr, format: 'amr' };

  const mp3 = `${base}.mp3`;
  const r2 = spawnSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', input,
    '-c:a', 'libmp3lame', '-b:a', '64k', mp3,
  ], { encoding: 'utf8' });
  if (r2.status === 0 && existsSync(mp3)) return { file: mp3, format: 'mp3' };

  return { file: input, format: 'wav' };
}


/**
 * 本地 TTS provider（GPT-SoVITS / CosyVoice 等本地服务）。
 *
 * 约定：服务端实现 GPT-SoVITS 的 api_v2 兼容接口 ——
 *   POST <endpoint>/tts  { text, text_lang, ref_audio_path, prompt_text, prompt_lang }
 *   → 返回 wav 原始字节
 * 这样云（Qwen-TTS）与本地（克隆音色）共用同一条发送链路，只是换 provider。
 */
export interface LocalTtsOptions {
  endpoint: string;
  refAudio?: string;
  promptText?: string;
  textLang?: string;
  promptLang?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export async function synthesizeLocal(
  text: string,
  options: LocalTtsOptions,
): Promise<Buffer | null> {
  const trimmed = String(text ?? '').trim();
  if (trimmed === '') return null;
  if (!options.endpoint) return null;

  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(options.endpoint.replace(/\/$/, '') + '/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: trimmed,
        text_lang: options.textLang ?? 'zh',
        ref_audio_path: options.refAudio ?? '',
        prompt_text: options.promptText ?? '',
        prompt_lang: options.promptLang ?? 'zh',
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 120_000),
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > 0 ? buf : null;
  } catch {
    return null;
  }
}

/** 把本地合成结果落盘 */
export function saveAudioBuf(buf: Buffer, dir: string, ext = 'wav'): string {
  mkdirSync(dir, { recursive: true });
  const file = joinPath(dir, `tts-local-${Date.now()}.${ext}`);
  writeFileSync(file, buf);
  return file;
}
