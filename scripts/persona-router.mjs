#!/usr/bin/env node
/**
 * 人格路由：按当场场景挑一个预设人格，给出「这一段该怎么说话」的提示。
 *
 * 为什么不用 Jev：Jev 是三选一决策器（reply/wait/skip），今天实测置信度 0.13~0.82，
 * 本来就谨慎；让它逐条判人格既没训练过、又贵、还会抖——人格一抖，群里立刻看出
 * 这号被轮着用，那比说错话更毁。
 *
 * 所以这里全是便宜且稳定的信号：问句、求助词、技术词、对骂词、情绪词。
 * 一次切换管 TTL（默认 30 分钟），期间不再变；只在场景真的换了才写日志。
 *
 * 用法：
 *   node scripts/persona-router.mjs --scope 913807639 --text "..."   # 单次判断
 *   echo '[...]' | node scripts/persona-router.mjs --scope X --stdin # 从 stdin 读消息数组
 *   node scripts/persona-router.mjs --scope X --show                 # 看当前状态
 *   node scripts/persona-router.mjs --scope X --clear                # 清掉（回到基线）
 *
 * 作为模块：
 *   import { pickScene, currentHint } from './persona-router.mjs';
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATE_DIR = path.join(ROOT, 'private', '.persona-router');
const LOG = path.join(ROOT, 'output', 'persona-router.log');
const DEFAULT_TTL_MIN = Number(process.env.QCE_ROUTER_TTL_MIN ?? 30);

/** 场景定义：关键词越靠前权重越大，够简单才不容易误判 */
const SCENES = [
  // 顺序有意义：同分时排前面的赢。「接口报错怎么办」应该像技术宅，不像暖心管家。
  {
    id: 'tech',
    preset: 'tech-geek',
    label: '在聊技术细节',
    words: ['代码', '接口', '报错', '配置', '部署', '数据库', '脚本', '正则', '编译',
      'docker', 'git', 'python', 'node', 'npm', '内存', '显卡', '性能', '并发', '日志', 'bug'],
    asksQuestion: 0.5,
  },
  {
    id: 'help',
    preset: 'warm-helper',
    label: '有人需要帮忙或情绪不佳',
    words: ['帮我看', '帮我查', '怎么办', '怎么弄', '求救', '急', '不工作', '挂了',
      '难受', '烦死', '累死', '崩溃', 'emo', '哭', '失败了', '白干', '焦虑', '摆烂'],
    asksQuestion: 0.5,
  },
  {
    id: 'roast',
    preset: 'sharp-critic',
    label: '群里在互相开涮',
    words: ['傻', '弱智', '蠢', '垃圾', '就这', '笑死', '绷不住', '逆子',
      '爹', '儿子', '喷', '滚'],
  },
  {
    id: 'banter',
    preset: 'meme-bro',
    label: '闲聊玩梗',
    words: ['哈哈哈哈', '哈哈', '草', '233', '梗', '表情包', '乐子', '抽象', '整活',
      '离谱', '绷', '笑不活'],
  },
  {
    id: 'quiet',
    preset: 'cold-minimal',
    label: '一两句的短对话',
    words: [],
    maxChars: 5, // 极短（「在」「行」）才算话少；6~12 字属正常聊天
  },
];

function norm(s) {
  return String(s ?? '').toLowerCase();
}

/**
 * 判断场景。输入是最近几条消息（字符串或 {text} 对象）。
 * 返回 { id, preset, label, score, why }
 */
export function pickScene(messages) {
  const texts = messages
    .map((m) => (typeof m === 'string' ? m : m?.text ?? ''))
    .filter(Boolean);
  if (!texts.length) return { id: 'baseline', preset: null, label: '没有新消息', score: 0, why: '空' };

  const joined = texts.map(norm).join('\n');
  const hasQuestion = /[?？]|吗|呢|怎么|如何|为啥|为什么/.test(joined);
  const avgChars = texts.reduce((a, t) => a + t.length, 0) / texts.length;

  const scored = SCENES.map((s) => {
    let score = 0;
    const hits = [];
    for (const w of s.words) {
      if (joined.includes(norm(w))) {
        score += 1;
        hits.push(w);
      }
    }
    if (s.asksQuestion && hasQuestion) score += s.asksQuestion;
    if (s.maxChars && avgChars <= s.maxChars) score += 1;
    return { ...s, score, hits };
  }).sort((a, b) => b.score - a.score);

  const top = scored[0];
  // 门槛：光有问号（0.5 分）不算「在求助」或「在聊技术」——「在吗」「你知道不」满地都是。
  // 至少要命中一个词（≥1 分）才认这个场景。
  if (top.score < 1) {
    return { id: 'baseline', preset: null, label: '普通闲聊，用默认人格', score: top.score, why: '只像在问，没有实质信号' };
  }
  if (top.score <= 0) {
    return { id: 'baseline', preset: null, label: '普通闲聊，用默认人格', score: 0, why: '没有命中任何场景词' };
  }
  // quiet（话少）是最弱的信号：别人正聊技术/在求助时，回一句「行」很正常，
  // 不该因为平均字数短就把整段切成冷面。只在不命中任何其它场景时才认它。
  if (top.id === 'quiet') {
    const others = scored.filter((x) => x.id !== 'quiet');
    const bestOther = others.reduce((a, b) => (b.score > a.score ? b : a), { score: 0, id: 'none' });
    // 只有别人真的够格（≥1 分）才压过冷面；光有问号不算
    if (bestOther.score >= 1) {
      return {
        id: bestOther.id, preset: bestOther.preset, label: bestOther.label,
        score: bestOther.score, why: '短句但现在聊的是正事，不切冷面',
      };
    }
  }
  return {
    id: top.id,
    preset: top.preset,
    label: top.label,
    score: top.score,
    why: top.hits.length ? `命中 ${top.hits.slice(0, 4).join('、')}` : `平均 ${avgChars.toFixed(0)} 字`,
  };
}

// ── Jev 智能判层 ────────────────────────────────────
// 规则先判（便宜的初判 + 失败回落），Jev 在**同一个 state 上**做一次判断复核。
// 为什么一次就够：Jev 的边际成本≈0，state 才是开销大头——所以单位是
// 「一个 state → 一批判断」，不是每条消息一次（实测 439 输入 token ≈ $0.000018）。
// 号主要求用它；但失败/低置信度一律回落规则，不硬判。
const SCENE_CRITERIA = {
  tech: '在排技术问题：报错、配置、代码、部署、性能',
  help: '有人求助或情绪不佳：难受、崩溃、白干、要人帮',
  roast: '互相开涮、对骂、嘲讽，火药味明显',
  banter: '闲聊玩梗、开玩笑、整活，气氛轻松',
  quiet: '只说了几个字，寒暄或应答',
  baseline: '普通聊天，以上都算不上',
};

async function refineWithJev(scope, messages, ruleResult, opts = {}) {
  const { createClient } = await import('./jev-client.mjs');
  const client = createClient();
  if (!client.available) return null;

  const texts = messages.map((m) => (typeof m === 'string' ? m : m?.text ?? '')).filter(Boolean);
  const state = [
    `群号：${scope}`,
    `规则初判：${ruleResult.scene ?? 'none'}（依据：${ruleResult.why ?? '无'}）`,
    '最近消息：',
    texts.slice(-12).map((t, i) => `[#${i}] ${t.slice(0, 120)}`).join(String.fromCharCode(10)),
  ].join(String.fromCharCode(10));

  const r = await client.decide(state, {
    scene: {
      type: 'choice',
      instructions: '判断这一段群聊的性质，用来决定回复用什么口吻。只判断性质，不要评价内容好坏。',
      criteria: SCENE_CRITERIA,
    },
    heat: {
      type: 'score',
      instructions: '群内当前紧张程度（有无冲突、挑衅、情绪升温）',
      criteria: ['平静', '略有不快', '明显对线', '火药味很重'],
    },
  });

  const minConf = opts.minConfidence ?? 0.5;
  const scene = r.answers.scene;
  return {
    scene: scene.choice,
    confidence: scene.confidence,
    heat: r.answers.heat?.score ?? 0,
    model: r.model,
    costUsd: r.usage.costUsd,
    accepted: scene.choice !== 'baseline' && scene.confidence >= minConf,
  };
}

function statePath(scope) {
  return path.join(STATE_DIR, `${scope}.json`);
}

function readState(scope) {
  try {
    return JSON.parse(fs.readFileSync(statePath(scope), 'utf8'));
  } catch {
    return null;
  }
}

function writeState(scope, st) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(statePath(scope), JSON.stringify(st, null, 2) + '\n', 'utf8');
}

function log(line) {
  fs.mkdirSync(path.dirname(LOG), { recursive: true });
  fs.appendFileSync(LOG, `[${new Date().toLocaleString('zh-CN')}] ${line}\n`, 'utf8');
}

/** 人明确指定过模板（persona use 写的文件）时，路由不插手 */
export function manualPreset(scope) {
  const f = path.join(ROOT, 'private', 'personas', `${scope}.md`);
  if (!fs.existsSync(f)) return null;
  const head = fs.readFileSync(f, 'utf8').slice(0, 400);
  const m = /^#\s*预设：/.exec(head);
  return m ? f : null; // 只有像预设的才认，避免误判手写人格
}

/**
 * 主入口：可能切换，返回当前应该用的提示。
 * 不写人格文件——只在状态里记，并把提示交给调用方塞进投递文本。
 */
export function route(scope, messages, opts = {}) {
  const ttlMin = opts.ttlMin ?? DEFAULT_TTL_MIN;
  const now = Date.now();
  const scene = pickScene(messages);
  const cur = readState(scope);

  const manual = manualPreset(scope);
  if (manual) {
    return { preset: null, hint: '', manual: true, reason: '有人明确指定了模板，路由不插手' };
  }

  const fresh = cur && cur.until && cur.until > now;
  if (fresh && cur.scene === scene.id) {
    return { preset: cur.preset, hint: cur.hint, kept: true, scene: scene.id };
  }
  // 粘滞：这一段刚开始没多久，除非新场景明显更强（分差 ≥2），否则不换。
  // 否则「技术讨论里插一句短话」就能把人格切走，一天能抖十几次。
  if (fresh && cur.preset && scene.preset && scene.id !== cur.scene) {
    const gap = (scene.score ?? 0) - (cur.score ?? 0);
    if (gap < 2) {
      return { preset: cur.preset, hint: cur.hint, kept: true, scene: cur.scene, reason: `新场景(${scene.id})不够强，保持` };
    }
  }

  if (!scene.preset) {
    if (cur) writeState(scope, { ...cur, until: 0, at: now });
    return { preset: null, hint: '', scene: scene.id, reason: scene.label };
  }

  const st = {
    scene: scene.id,
    preset: scene.preset,
    since: cur && cur.scene === scene.id ? cur.since ?? now : now,
    until: now + ttlMin * 60_000,
    at: now,
    score: scene.score ?? 0,
    why: scene.why,
    hint: `（这一段像「${scene.label}」，用 ${scene.preset} 的口吻；预设见 private/personas/presets/${scene.preset}.md）`,
  };
  writeState(scope, st);
  log(`切到 ${scene.preset}（${scene.id}）— ${scene.why}${fresh ? `，原 ${cur.preset}` : ''}`);
  return { preset: st.preset, hint: st.hint, scene: scene.id, why: scene.why, switched: true };
}

/** 给投递用：读当前状态，给出提示行（过期就空） */
export function currentHint(scope) {
  const cur = readState(scope);
  if (!cur || !cur.until || cur.until < Date.now()) return '';
  return cur.hint ?? '';
}

// ── CLI ──────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('persona-router.mjs')) {
  const argv = process.argv.slice(2);
  const arg = (k, d = null) => {
    const i = argv.indexOf(k);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
  };
  const scope = arg('--scope', 'default');

  if (argv.includes('--show')) {
    const st = readState(scope);
    console.log(st ? JSON.stringify(st, null, 2) : '(没有状态，等于用基线人格)');
  } else if (argv.includes('--clear')) {
    fs.rmSync(statePath(scope), { force: true });
    console.log('已清除');
  } else {
    let messages = [];
    if (argv.includes('--stdin')) {
      const raw = fs.readFileSync(0, 'utf8').trim();
      try {
        const j = JSON.parse(raw);
        messages = Array.isArray(j) ? j : [j];
      } catch {
        messages = raw.split('\n');
      }
    } else {
      const t = arg('--text', '');
      messages = t ? t.split('\n') : [];
    }
    const r = route(scope, messages, { ttlMin: Number(arg('--ttl', DEFAULT_TTL_MIN)) });

    // Jev 复核（默认 auto：有 key 就用，没 key / 出错 / 低置信度一律回落规则）
    const jevMode = arg('--jev', process.env.QCE_ROUTER_JEV ?? 'auto');
    if (jevMode !== 'off' && !r.manual) {
      try {
        const refined = await refineWithJev(scope, messages, r, {
          minConfidence: Number(arg('--min-conf', 0.5)),
        });
        if (refined) {
          r.jev = {
            scene: refined.scene, confidence: Number(refined.confidence.toFixed(2)),
            heat: refined.heat, model: refined.model,
            costUsd: Number(refined.costUsd.toFixed(6)), accepted: refined.accepted,
          };
          const presetFor = Object.fromEntries(SCENES.map((x) => [x.id, x]));
          const target = presetFor[refined.scene];
          if (refined.accepted && target && target.preset !== r.preset) {
            // Jev 认为该换：它比规则看得全（能理解「这句话其实是在阴阳」这种规则抓不到的）
            const now = Date.now();
            writeState(scope, {
              scene: refined.scene, preset: target.preset, score: 3,
              since: now, until: now + Number(arg('--ttl', DEFAULT_TTL_MIN)) * 60_000, at: now,
              why: `Jev ${refined.confidence.toFixed(2)} 判为 ${refined.scene}`,
              hint: `（这一段像「${target.label}」，用 ${target.preset} 的口吻；预设见 private/personas/presets/${target.preset}.md）`,
              by: 'jev', model: refined.model,
            });
            log(`Jev 改判 → ${target.preset}（${refined.scene} ${refined.confidence.toFixed(2)}，规则原判 ${r.scene}，模型 ${refined.model}，$${refined.costUsd.toFixed(6)}）`);
            r.preset = target.preset;
            r.scene = refined.scene;
            r.hint = `（这一段像「${target.label}」，用 ${target.preset} 的口吻；预设见 private/personas/presets/${target.preset}.md）`;
            r.switched = true;
            r.by = 'jev';
          }
        }
      } catch (e) {
        r.jevError = String(e.message).slice(0, 120);
        log(`Jev 失败回落规则：${e.message}`);
      }
    }

    console.log(JSON.stringify(r, null, 2));
  }
}
