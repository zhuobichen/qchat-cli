#!/usr/bin/env node
/**
 * 梗库实时更新：从热榜捞候选 → 让 AI 判断是不是梗 → 是就补解释入库。
 *
 * 为什么不能只用静态数据集：CHIME 是 2025 年的快照，互联网每天都在造新梗。
 * 跟不上就会出现"群友说的是这个月的新词，bot 一脸茫然"。
 *
 * 三个信号源，按可信度排序：
 *   1. 群内生词（detectUnknownTerms 已经在做）—— **最准**，因为这正是群友在用的
 *   2. B站热门视频标题 —— 新梗通常先出现在标题和弹幕里
 *   3. B站热搜关键词 —— 偏新闻，但能捞到出圈的梗
 *
 * 防污染：不是把热词直接塞进库，而是让 AI 判定「这是不是网络梗」，
 * 是才补解释。否则一天的新闻词就能把词库淹了。
 *
 * 用法：
 *   node scripts/refresh-memes.mjs                    # 默认跑一次（最多补 15 条）
 *   node scripts/refresh-memes.mjs --dry              # 只看候选，不调 AI
 *   node scripts/refresh-memes.mjs --limit 30         # 多补一些
 *   node scripts/refresh-memes.mjs --source hot       # 只跑 B 站热搜
 */
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const TERMS = join(process.cwd(), 'private', 'knowledge', 'terms.jsonl');
const CANDIDATES = join(process.cwd(), 'private', 'knowledge', 'candidates.jsonl');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const argOf = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : dflt;
};
const DRY = process.argv.includes('--dry');
const LIMIT = Math.max(0, Number(argOf('--limit', '15')) || 15);
const ONLY = argOf('--source', '');

function loadTerms() {
  if (!existsSync(TERMS)) return [];
  return readFileSync(TERMS, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

async function biliHot() {
  const res = await fetch('https://api.bilibili.com/x/web-interface/search/square?limit=20', {
    headers: { 'User-Agent': UA, Referer: 'https://www.bilibili.com' },
    signal: AbortSignal.timeout(15000),
  });
  const json = await res.json();
  const list = json?.data?.trending?.list ?? [];
  return list.map((x) => ({ text: String(x.keyword ?? ''), from: 'bili-hot' })).filter((x) => x.text);
}

async function biliPopular() {
  const res = await fetch('https://api.bilibili.com/x/web-interface/popular?ps=30&pn=1', {
    headers: { 'User-Agent': UA, Referer: 'https://www.bilibili.com' },
    signal: AbortSignal.timeout(15000),
  });
  const json = await res.json();
  const list = json?.data?.list ?? [];
  return list.map((x) => ({ text: String(x.title ?? ''), from: 'bili-popular' })).filter((x) => x.text);
}

/**
 * 用 jieba 分词，取候选词。
 *
 * 试过用「滑动窗口切 2~6 字」的土办法 —— 切出来全是「国走」「是好」「坞配」
 * 这种碎片，既浪费 AI 判定成本，又会把垃圾词塞进词库。
 * 中文必须走真分词。
 */
function segmentCandidates(texts, known) {
  const knownSet = new Set(known.map((t) => t.term));
  const tmp = join(process.cwd(), '.tmp-seg.txt');
  writeFileSync(tmp, texts.join(String.fromCharCode(10)), 'utf8');

  const pyCandidates = [
    'D:/github_project/ZhaoWen_GitHub维护/_seedvc/.venv/Scripts/python.exe',
    'python',
  ];
  const script = join(process.cwd(), 'scripts', 'segment.py');
  let out = '';
  for (const py of pyCandidates) {
    const r = spawnSync(py, [script, tmp, '--min', '2', '--max', '6'], {
      encoding: 'utf8',
      timeout: 60000,
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });
    const startIdx = (r.stdout || '').indexOf('[');
    if (r.status === 0 && startIdx >= 0) {
      out = r.stdout.slice(startIdx);
      break;
    }
  }
  if (!out) {
    console.log('⚠ 分词失败（缺 jieba），跳过候选提取');
    return [];
  }
  let parsed = [];
  try {
    parsed = JSON.parse(out);
  } catch {
    return [];
  }
  return parsed
    .filter((x) => !knownSet.has(x.word) && x.n >= 1)
    .map((x) => ({ word: x.word, n: x.n, context: x.context ?? '' }));
}

/** 让 AI 判定这个词是不是网络梗，并给出解释。不是就返回 null */
async function classifyWithAi(word, context) {
  const env = process.env;
  const key = env.DASHSCOPE_API_KEY || env.QCE_DASHSCOPE_KEY || '';
  if (!key) return null;
  const prompt = [
    '你在维护一个中文网络梗词库。判断下面这个词是不是「网络流行语/梗/黑话」。',
    '如果是，用一句话（40字内）解释它的意思，并给一个例句。',
    '如果不是（普通词语、人名、新闻事件、地名、作品名），只回 NOT_A_MEME。',
    '',
    `词：${word}`,
    `出现语境：${context.slice(0, 80)}`,
    '',
    '格式严格为两行：',
    'MEANING: <解释>',
    'USAGE: <例句>',
  ].join('\n');

  const res = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: env.QCE_TEXT_MODEL || 'qwen-plus',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 200,
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) return null;
  const json = await res.json();
  const raw = String(json?.choices?.[0]?.message?.content ?? '').trim();
  if (!raw || /NOT_A_MEME/i.test(raw)) return null;
  const meaning = (raw.match(/MEANING:\s*(.+)/)?.[1] ?? '').trim();
  const usage = (raw.match(/USAGE:\s*(.+)/)?.[1] ?? '').trim();
  if (!meaning) return null;
  return { meaning: meaning.slice(0, 200), usage: usage.slice(0, 120) };
}

const known = loadTerms();
console.log(`现有词库: ${known.length} 条`);

const sources = [];
if (!ONLY || ONLY === 'hot') {
  try { sources.push(...(await biliHot())); console.log('B站热搜 ✅'); } catch (e) { console.log('B站热搜 ❌', e.message); }
}
if (!ONLY || ONLY === 'popular') {
  try { sources.push(...(await biliPopular())); console.log('B站热门 ✅'); } catch (e) { console.log('B站热门 ❌', e.message); }
}

const cands = segmentCandidates(sources.map((s) => s.text), known);
console.log(`候选词: ${cands.length} 个（未入库）`);

if (DRY) {
  console.log('\n前 20 个候选（仅供参考，未判定）:');
  for (const c of cands.slice(0, 20)) console.log(`  ${c.word} (${c.n})`);
  process.exit(0);
}

// 只挑出现次数多的前 N 个送去判定，控制成本
const batch = cands.slice(0, LIMIT);
let added = 0;
let rejected = 0;

for (const c of batch) {
  const context = c.context || sources.find((s) => s.text.includes(c.word))?.text || '';
  let verdict = null;
  try {
    verdict = await classifyWithAi(c.word, context);
  } catch {
    /* 单条失败继续 */
  }
  if (!verdict) { rejected += 1; continue; }
  const entry = {
    term: c.word,
    meaning: verdict.meaning,
    ...(verdict.usage ? { usage: verdict.usage } : {}),
    tone: '新词（待观察）',
    scope: 'global',
    source: 'live',
    addedAt: Date.now(),
  };
  appendFileSync(TERMS, JSON.stringify(entry) + '\n', 'utf8');
  added += 1;
  console.log(`  + 「${c.word}」 ${verdict.meaning.slice(0, 40)}`);
}

// 候选池留档，便于人工回头审
if (cands.length) {
  appendFileSync(
    CANDIDATES,
    cands.slice(0, 200).map((c) => JSON.stringify({ ...c, at: Date.now() })).join('\n') + '\n',
    'utf8',
  );
}

console.log(`\n新增 ${added} 条，判定为非梗 ${rejected} 条，词库现在 ${known.length + added} 条`);
