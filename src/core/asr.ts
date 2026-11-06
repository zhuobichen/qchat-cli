/**
 * 语音转写：把语音条转成文字，作为「合成消息」并入索引。
 *
 * 与图片 OCR 同一套思路（见 ocr.ts）：
 *   - 合成消息 id = `asr:<消息id>:<序号>`，天然幂等
 *   - 转写失败/空文本就跳过，不产生脏数据
 *
 * 转写本身交给 Python（scripts/asr_audio.py，faster-whisper 离线模型），
 * 这里只负责调用与结果整形，便于单测。
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { resolvePython } from './ocr.js';

export interface AsrResult {
  file: string;
  text: string;
  language?: string;
  duration?: number;
  error?: string;
}

/** 默认脚本路径：以本模块位置为基准找 scripts/asr_audio.py */
export function defaultAsrScript(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'asr_audio.py');
}

/** 调 Python 侧转写。失败返回空数组，不抛。 */
export function runAsr(
  files: string[],
  options: { python?: string; script?: string; timeoutMs?: number; model?: string } = {},
): AsrResult[] {
  if (files.length === 0) return [];
  const python = resolvePython(options.python);
  const script = options.script || process.env.QCE_ASR_SCRIPT || defaultAsrScript();
  if (!existsSync(script)) return [];

  const env: NodeJS.ProcessEnv = { ...process.env, HF_HUB_OFFLINE: '1' };
  if (options.model) env.QCE_ASR_MODEL = options.model;

  const r = spawnSync(python, [script, ...files], {
    encoding: 'utf8',
    timeout: options.timeoutMs ?? 600_000,
    maxBuffer: 32 * 1024 * 1024,
    env,
  });
  if (r.status !== 0 || !r.stdout) return [];

  try {
    const parsed = JSON.parse(r.stdout);
    return Array.isArray(parsed?.results) ? parsed.results : [];
  } catch {
    return [];
  }
}

/** 把转写结果做成可入库的合成消息 */
export function toVoiceMessages(
  base: { id: string; groupId?: number; time: number; senderId: number; senderName: string },
  results: AsrResult[],
): { id: string; groupId: number; time: number; senderId: number; senderName: string; text: string }[] {
  const out = [];
  let index = 0;
  for (const item of results) {
    const text = (item.text || '').trim();
    if (!text) continue;
    out.push({
      id: `asr:${base.id}:${index}`,
      groupId: base.groupId ?? 0,
      time: base.time,
      senderId: base.senderId,
      senderName: base.senderName,
      text: `[语音文字] ${text}`,
    });
    index += 1;
  }
  return out;
}
