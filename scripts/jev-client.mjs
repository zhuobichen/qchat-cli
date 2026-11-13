#!/usr/bin/env node
/**
 * Jev（TypeSafe System One）客户端——决策专用，不做生成。
 *
 * 为什么单独一个文件：契约只有一份实现，别处不许另写。
 * 契约来源是 WeFlow CLI 的施工文档（zhuobichen/weflow-cli docs/JEV应用施工文档.md）
 * 加实测，不是转述：
 *   POST /v1/systemone   {model, state, questions}  →  {model, answers, usage}
 *
 * 三条要紧的性质：
 * 1. 一个 state 问一批问题的边际成本≈0，**state 才是开销大头**。
 *    所以用法是「一个 state → 一批判断」，不是每个问题单独调一次。
 * 2. choice 的 criteria 是**对象** {选项: 何时选它}，选项集合就是 criteria 本身——
 *    少写一个选项，模型永远选不到它。
 * 3. 契约漂移的失效方式是**选错了但看起来正常**，所以每个 choice 都过四道硬校验。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export const DEFAULT_ENDPOINT = 'https://api.302ai.cn/typesafeai/v1/systemone';
export const DEFAULT_MODEL = process.env.JEV_MODEL || 'typesafe/jev-1.14-20261014';

// 输入 token 单价（USD / 1M）。输出在推广期不计费。
const INPUT_USD_PER_MTOKEN = 0.042;

function readKey() {
  if (process.env.JEV_API_KEY) return process.env.JEV_API_KEY;
  // 常驻脚本不一定加载 .env，这里自己补一次（只读，不打印）
  try {
    const env = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
    const m = /^JEV_API_KEY=(.+)$/m.exec(env);
    if (m) return m[1].trim();
  } catch { /* 没 .env */ }
  return '';
}

export class JevError extends Error {}

/**
 * choice 答案的四道硬校验（照 WeFlow 的 jev_client.py 抄的，不能放宽）：
 * 键集相等 / 值在 [0,1] / 和≈1（容差 0.02）/ choice 是 argmax
 */
export function checkChoice(answer, criteria) {
  const probs = answer?.probabilities;
  if (!probs || typeof probs !== 'object') throw new JevError('choice 缺少 probabilities');
  const pk = Object.keys(probs).sort().join('|');
  const ck = Object.keys(criteria).sort().join('|');
  if (pk !== ck) throw new JevError(`probabilities 键集与 criteria 不一致：${pk} vs ${ck}`);
  let sum = 0;
  let argmax = null;
  let best = -1;
  for (const [k, v] of Object.entries(probs)) {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 1) throw new JevError(`概率越界：${k}=${v}`);
    sum += n;
    if (n > best) { best = n; argmax = k; }
  }
  if (Math.abs(sum - 1) > 0.02) throw new JevError(`概率和 ${sum.toFixed(3)} 不等于 1`);
  if (answer.choice !== argmax) throw new JevError(`choice=${answer.choice} 不是 argmax=${argmax}`);
  const confidence = Number(answer.confidence);
  return { choice: answer.choice, confidence: Number.isFinite(confidence) ? confidence : best, probabilities: probs };
}

export function createClient(opts = {}) {
  const apiKey = opts.apiKey ?? readKey();
  const endpoint = opts.endpoint ?? process.env.JEV_ENDPOINT ?? DEFAULT_ENDPOINT;
  const model = opts.model ?? DEFAULT_MODEL;
  const timeoutMs = opts.timeoutMs ?? 20_000;
  let lastModel = null;
  let spentUsd = 0;
  let calls = 0;

  return {
    get available() { return Boolean(apiKey); },
    get lastModel() { return lastModel; },
    get stats() { return { calls, spentUsd, model: lastModel }; },

    /**
     * 一次调用问一批问题。questions 形状：
     *   { 名字: { type:'choice', instructions, criteria:{选项:判据} } }
     *   { 名字: { type:'score',  instructions, criteria:[档0,档1,...] } }
     *   { 名字: { type:'noul',   instructions } }
     */
    async decide(state, questions, { timeout } = {}) {
      if (!apiKey) throw new JevError('没有 JEV_API_KEY');
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, state, questions }),
        signal: AbortSignal.timeout(timeout ?? timeoutMs),
      });
      const raw = await res.text();
      if (!res.ok) throw new JevError(`HTTP ${res.status}: ${raw.slice(0, 200)}`);

      let payload;
      try { payload = JSON.parse(raw); } catch { throw new JevError('响应不是 JSON'); }

      // 每次响应都带实际服务的版本；别名的漂移只有这里看得见
      lastModel = payload?.model ?? null;
      const usage = payload?.usage ?? {};
      const inTok = Number(usage.input_tokens ?? 0);
      const usd = (inTok / 1_000_000) * INPUT_USD_PER_MTOKEN;
      spentUsd += usd;
      calls += 1;

      const answers = {};
      for (const [name, q] of Object.entries(questions)) {
        const a = payload?.answers?.[name];
        if (!a) throw new JevError(`缺少答案：${name}`);
        if (q.type === 'choice') answers[name] = checkChoice(a, q.criteria);
        else if (q.type === 'score') {
          const score = Number(a.score);
          if (!Number.isFinite(score)) throw new JevError(`score 非数字：${name}`);
          answers[name] = { score, confidence: Number(a.confidence ?? NaN) };
        } else answers[name] = { noul: Number(a.noul) };
      }
      return { answers, usage: { ...usage, costUsd: usd }, model: lastModel, raw: payload };
    },
  };
}
