import { describe, it, expect } from 'vitest';
import { extractAudioUrl, synthesize, detectSilence } from './tts.js';

describe('extractAudioUrl', () => {
  it('标准 output.audio.url', () => {
    const out = extractAudioUrl({ output: { audio: { url: 'https://x/a.mp3', expires_at: 123 } } });
    expect(out).toEqual({ url: 'https://x/a.mp3', expiresAt: 123 });
  });

  it('output.audio 直接是字符串', () => {
    expect(extractAudioUrl({ output: { audio: 'https://x/b.wav' } })?.url).toBe('https://x/b.wav');
  });

  it('output.audio_url 兜底', () => {
    expect(extractAudioUrl({ output: { audio_url: 'https://x/c.mp3' } })?.url).toBe('https://x/c.mp3');
  });

  it('缺字段返回 null', () => {
    expect(extractAudioUrl({})).toBeNull();
    expect(extractAudioUrl(null)).toBeNull();
    expect(extractAudioUrl({ output: { audio: {} } })).toBeNull();
  });

  it('过期时间缺失时给 0', () => {
    expect(extractAudioUrl({ output: { audio: { url: 'https://x' } } })?.expiresAt).toBe(0);
  });
});

describe('synthesize', () => {
  const okPayload = { output: { audio: { url: 'https://oss/a.mp3', expires_at: 999 } } };

  it('成功时返回 url', async () => {
    const fake = (async () => ({ ok: true, json: async () => okPayload } as any)) as unknown as typeof fetch;
    const out = await synthesize('你好', { apiKey: 'k', fetchImpl: fake });
    expect(out?.url).toBe('https://oss/a.mp3');
  });

  it('空文本不发请求', async () => {
    let called = false;
    const fake = (async () => { called = true; return { ok: true, json: async () => okPayload } as any; }) as unknown as typeof fetch;
    expect(await synthesize('   ', { apiKey: 'k', fetchImpl: fake })).toBeNull();
    expect(called).toBe(false);
  });

  it('无 key 返回 null', async () => {
    expect(await synthesize('你好', { apiKey: '' })).toBeNull();
  });

  it('HTTP 错误返回 null', async () => {
    const fake = (async () => ({ ok: false, status: 500 } as any)) as unknown as typeof fetch;
    expect(await synthesize('你好', { apiKey: 'k', fetchImpl: fake })).toBeNull();
  });

  it('网络异常返回 null', async () => {
    const fake = (async () => { throw new Error('boom'); }) as unknown as typeof fetch;
    expect(await synthesize('你好', { apiKey: 'k', fetchImpl: fake })).toBeNull();
  });

  it('返回体没有 url 时返回 null', async () => {
    const fake = (async () => ({ ok: true, json: async () => ({ output: {} }) } as any)) as unknown as typeof fetch;
    expect(await synthesize('你好', { apiKey: 'k', fetchImpl: fake })).toBeNull();
  });
});

import { synthesizeLocal, saveAudioBuf } from './tts.js';

describe('synthesizeLocal（本地克隆音色）', () => {
  it('成功时返回音频字节', async () => {
    const fake = (async () => ({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    } as any)) as unknown as typeof fetch;
    const buf = await synthesizeLocal('你好', { endpoint: 'http://127.0.0.1:9880', fetchImpl: fake });
    expect(buf?.length).toBe(3);
  });

  it('空文本 / 空端点不发请求', async () => {
    expect(await synthesizeLocal('  ', { endpoint: 'http://x' })).toBeNull();
    expect(await synthesizeLocal('你好', { endpoint: '' })).toBeNull();
  });

  it('服务报错返回 null', async () => {
    const fake = (async () => ({ ok: false, status: 500 } as any)) as unknown as typeof fetch;
    expect(await synthesizeLocal('你好', { endpoint: 'http://x', fetchImpl: fake })).toBeNull();
  });

  it('空音频视为失败', async () => {
    const fake = (async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) } as any)) as unknown as typeof fetch;
    expect(await synthesizeLocal('你好', { endpoint: 'http://x', fetchImpl: fake })).toBeNull();
  });

  it('saveAudioBuf 落盘', () => {
    const { mkdtempSync } = require('node:fs');
    const { tmpdir } = require('node:os');
    const { join } = require('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'qce-tts-'));
    const f = saveAudioBuf(Buffer.from([1, 2]), dir);
    expect(f.endsWith('.wav')).toBe(true);
  });
});

describe('detectSilence 静音自检', () => {
  function makeWav(peak: number, seconds = 1, rate = 16000): Buffer {
    const n = rate * seconds;
    const data = Buffer.alloc(n * 2);
    for (let i = 0; i < n; i += 1) {
      // 简单的方波，峰值可控
      data.writeInt16LE(i % 2 === 0 ? peak : -peak, i * 2);
    }
    const header = Buffer.alloc(44);
    header.write('RIFF', 0, 'ascii');
    header.writeUInt32LE(36 + data.length, 4);
    header.write('WAVE', 8, 'ascii');
    header.write('fmt ', 12, 'ascii');
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(rate, 24);
    header.writeUInt32LE(rate * 2, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36, 'ascii');
    header.writeUInt32LE(data.length, 40);
    return Buffer.concat([header, data]);
  }

  it('正常音量的音频不算静音', () => {
    expect(detectSilence(makeWav(8000)).silent).toBe(false);
  });

  it('近乎无声的 WAV 判为静音（实测故障时峰值约 395）', () => {
    const r = detectSilence(makeWav(395));
    expect(r.silent).toBe(true);
    expect(r.peak).toBe(395);
  });

  it('全零判为静音', () => {
    expect(detectSilence(makeWav(0)).silent).toBe(true);
  });

  it('阈值可调', () => {
    expect(detectSilence(makeWav(600), 500).silent).toBe(false);
    expect(detectSilence(makeWav(600), 700).silent).toBe(true);
  });

  it('不是 WAV 时不误杀', () => {
    expect(detectSilence(Buffer.from('not a wav at all')).silent).toBe(false);
  });

  it('太短的 buffer 不误杀', () => {
    expect(detectSilence(Buffer.alloc(10)).silent).toBe(false);
  });
});
