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
import { dirname, join as joinPath, resolve as resolvePath } from 'node:path';
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
  if (process.env.QCE_FFMPEG && existsSync(process.env.QCE_FFMPEG)) return process.env.QCE_FFMPEG;

  // PATH 里优先
  const probe = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
  if (probe.status === 0) return 'ffmpeg';

  // PATH 里没有就去常见位置找。
  // 为什么必须兜住：找不到 ffmpeg 就只能发 wav，而 NapCat 对 wav 支持很差
  // （实测报"语音转换失败"），表现是语音发不出去但日志只写一行"没找到 ffmpeg"。
  const candidates = [
    joinPath(process.cwd(), 'thirdparty', 'ffmpeg', 'ffmpeg.exe'),
    joinPath(process.cwd(), 'ffmpeg', 'ffmpeg.exe'),
    joinPath(process.cwd(), '..', 'thirdparty', 'ffmpeg', 'ffmpeg.exe'),
    'D:\github_project\ZhaoWen_GitHub维护\thirdparty\ffmpeg\ffmpeg.exe',
    'C:\ffmpeg\bin\ffmpeg.exe',
  ];
  for (const c of candidates) {
    try {
      if (existsSync(c)) return c;
    } catch {
      /* 下一个 */
    }
  }
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

  // 参考音频必须是绝对路径。
  // GPT-SoVITS 是独立进程，它按自己的 cwd 解析相对路径——传相对路径会 500/静音，
  // 而错误信息只是"检查服务是否在跑"，很容易误判成服务挂了。
  const refAudio = options.refAudio ? resolvePath(options.refAudio) : '';

  // 参考音频不存在时直接说清楚。
  // 不检查的话，服务端只会 500，而我们统一报"检查服务是否在跑"——
  // 实测这个误导性提示让人去重启服务，而真正原因是路径写错。
  if (refAudio && !existsSync(refAudio)) {
    throw new Error(`参考音频不存在：${refAudio}（传绝对路径或相对当前目录的路径）`);
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(options.endpoint.replace(/\/$/, '') + '/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: trimmed,
        text_lang: options.textLang ?? 'zh',
        ref_audio_path: refAudio,
        prompt_text: options.promptText ?? '',
        prompt_lang: options.promptLang ?? 'zh',
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 120_000),
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) return null;

    // 静音自检：参考音频和 prompt_text 对不上时，GPT-SoVITS 不报错，
    // 而是返回一段**几乎无声**的 wav（实测峰值 395 / 正常 8000+）。
    // 不检的话表现是"语音发出去了"，对方听到一片安静，极难排查。
    const silence = detectSilence(buf);
    if (silence.silent) {
      throw new Error(
        `合成结果是静音（峰值 ${silence.peak}，阈值 ${silence.threshold}）——` +
        `多半是参考音频与 prompt_text 不匹配，或参考音频路径不对：${refAudio}`,
      );
    }
    return buf;
  } catch (error) {
    // 静音是我们主动抛的，要让调用方看见原因；网络错误仍然返回 null
    if (error instanceof Error && (
      error.message.includes('合成结果是静音') ||
      error.message.includes('参考音频不存在')
    )) throw error;
    return null;
  }
}

/**
 * 判断 WAV 是不是静音。
 * 只看前 3 秒（够判断了），按 int16 小端解析。
 */
export function detectSilence(wav: Buffer, threshold = 500): { silent: boolean; peak: number; threshold: number } {
  // 跳过 44 字节标准 WAV 头；找不到 RIFF 就保守认为"不静音"（别误杀）
  if (wav.length < 46 || wav.slice(0, 4).toString('ascii') !== 'RIFF') {
    return { silent: false, peak: -1, threshold };
  }
  const start = 44;
  const maxSamples = Math.min((wav.length - start) / 2, 16000 * 3);
  let peak = 0;
  for (let i = 0; i < maxSamples; i += 1) {
    const v = Math.abs(wav.readInt16LE(start + i * 2));
    if (v > peak) peak = v;
  }
  return { silent: peak < threshold, peak, threshold };
}

/** 把本地合成结果落盘 */
export function saveAudioBuf(buf: Buffer, dir: string, ext = 'wav'): string {
  mkdirSync(dir, { recursive: true });
  const file = joinPath(dir, `tts-local-${Date.now()}.${ext}`);
  writeFileSync(file, buf);
  return file;
}
