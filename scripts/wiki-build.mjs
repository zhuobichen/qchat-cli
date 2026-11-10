/**
 * 把词库变成 wiki。
 *
 * 为什么要有 wiki：terms.jsonl 是给机器人查的（一行一条，快），
 * 但人看不了——两三千行 JSON 没法翻。wiki 是给人看的形态：
 * 一个总目录、若干分类页、每个词条一页，页间互相连。
 *
 * 约定：
 *   private/wiki/index.md          总目录（按分类导航 + 统计）
 *   private/wiki/categories/*.md   分类页（一个标签一页）
 *   private/wiki/terms/*.md        词条页（含出处、标签、相关词条）
 *
 * 链接用 wiki 风格 [[词条名]]，在支持它的编辑器（Obsidian 等）里直接可跳。
 *
 * 用法：
 *   node scripts/wiki-build.mjs                 只生成 index + 分类页（默认）
 *   node scripts/wiki-build.mjs --with-terms    连每个词条一页也生成（慢，文件多）
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const TERMS = path.join(ROOT, 'private', 'knowledge', 'terms.jsonl');
const WIKI = path.join(ROOT, 'private', 'wiki');
const WITH_TERMS = process.argv.includes('--with-terms');

/** 文件名安全化：去掉路径分隔符和保留字符 */
function safeName(s) {
  return s.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80);
}

function loadTerms() {
  const out = [];
  for (const line of fs.readFileSync(TERMS, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const d = JSON.parse(line);
      if (d?.term && d?.meaning) out.push(d);
    } catch {
      /* 坏行跳过 */
    }
  }
  return out;
}

/**
 * 分类轴：梗是"什么时候火"最有信息量，所以主轴用年月；
 * 副轴用首字，方便按名字找。
 *
 * 不用站上的 tags —— 实测那些标签是词条名的碎片
 * （「女孩」「不是」「什么」），当分类毫无意义。
 */
function monthOf(t) {
  const e = String(t.era ?? '');
  const m = /^(\d{4}-\d{2})/.exec(e);
  if (m) return m[1];
  // 没有 era 就老实标"未标日期"，不要伪造成本月
  //（chime 旧数据集 1282 条都是这样，塞进当前月会让时间轴失真）
  return '未标日期';
}

function firstCharOf(t) {
  const c = String(t.term).trim()[0] ?? '#';
  return /[a-zA-Z]/.test(c) ? c.toUpperCase() : c;
}

function main() {
  const terms = loadTerms();
  terms.sort((a, b) => (a.term < b.term ? -1 : a.term > b.term ? 1 : 0));

  fs.mkdirSync(path.join(WIKI, 'categories'), { recursive: true });
  if (WITH_TERMS) fs.mkdirSync(path.join(WIKI, 'terms'), { recursive: true });

  // 两套索引：按月（主轴）、按首字（副轴）
  const byMonth = new Map();
  const byLetter = new Map();
  for (const t of terms) {
    const m = monthOf(t);
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m).push(t);
    const c = firstCharOf(t);
    if (!byLetter.has(c)) byLetter.set(c, []);
    byLetter.get(c).push(t);
  }
  const months = [...byMonth.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  const letters = [...byLetter.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));

  fs.mkdirSync(path.join(WIKI, 'by-month'), { recursive: true });
  fs.mkdirSync(path.join(WIKI, 'by-letter'), { recursive: true });

  for (const [m, list] of months) {
    const lines = [`# ${m} 的梗`, '', `共 ${list.length} 条。`, ''];
    for (const t of list) {
      lines.push(`- **${t.term}**${t.risky ? ' ⚠️' : ''} —— ${t.meaning.replace(/\s+/g, ' ').slice(0, 90)}…`);
    }
    lines.push('', '---', '', '← 返回 [总目录](../index.md)');
    fs.writeFileSync(path.join(WIKI, 'by-month', `${safeName(m)}.md`), lines.join('\n'), 'utf8');
  }
  // 首字太碎（一个汉字一页没意义），只给 5 条以上的首字建页，其余并成「其他」
  const bigLetters = letters.filter(([, l]) => l.length >= 5);
  const smallLetters = letters.filter(([, l]) => l.length < 5).flatMap(([, l]) => l);
  const letterPages = [...bigLetters];
  if (smallLetters.length) letterPages.push(['其他', smallLetters]);
  fs.rmSync(path.join(WIKI, 'by-letter'), { recursive: true, force: true });
  fs.mkdirSync(path.join(WIKI, 'by-letter'), { recursive: true });
  for (const [c, list] of letterPages) {
    const lines = [`# ${c}`, '', `共 ${list.length} 条。`, ''];
    for (const t of list) lines.push(`- **${t.term}** —— ${t.meaning.replace(/\s+/g, ' ').slice(0, 70)}…`);
    lines.push('', '---', '', '← 返回 [总目录](../index.md)');
    fs.writeFileSync(path.join(WIKI, 'by-letter', `${safeName(c)}.md`), lines.join('\n'), 'utf8');
  }

  // 词条页（可选）
  if (WITH_TERMS) {
    for (const t of terms) {
      const m = monthOf(t);
      const lines = [
        `# ${t.term}`,
        '',
        `> ${t.era ?? ''}${t.verifiedBy ? ` · 来源 ${t.verifiedBy}` : ''}${t.priority === 'high' ? ' · 高优先级' : ''}${t.risky ? ' · ⚠️擦边内容' : ''}`,
        '',
        t.meaning,
        '',
      ];
      if (t.usage) lines.push('**例句**', '', `> ${t.usage}`, '');
      lines.push(`**归类**：[${m}](../by-month/${safeName(m)}.md)`, '');
      lines.push('---', '', '← 返回 [总目录](../index.md)');
      fs.writeFileSync(path.join(WIKI, 'terms', `${safeName(t.term)}.md`), lines.join('\n'), 'utf8');
    }
  }

  // 总目录
  const idx = [
    '# 梗库总目录',
    '',
    `共 **${terms.length}** 条词条。`,
    '',
    '来源：梗百科官网逐条抓取 + 热榜自动补充 + 人工核对。',
    '',
    '## 按时间（主力导航）',
    '',
    '梗是"什么时候火"最有信息量，按热度时间倒序：',
    '',
  ];
  for (const [m, list] of months) idx.push(`- [${m}](by-month/${m}.md) —— ${list.length} 条`);
  idx.push('', '## 按首字', '');
  idx.push(letterPages.map(([c, list]) => `[${c}](by-letter/${safeName(c)}.md)（${list.length}）`).join(' · '));
  idx.push('', '## 说明', '');
  idx.push('- 标 ⚠️ 的是擦边内容，不该在群里主动用。');
  idx.push('- 数据源：`private/knowledge/terms.jsonl`（机器人查的是这份，wiki 只是给人看的视图）。');
  fs.writeFileSync(path.join(WIKI, 'index.md'), idx.join('\n'), 'utf8');

  console.log(`完成：${terms.length} 条词条`);
  console.log(`  总目录: private/wiki/index.md`);
  console.log(`  按月: private/wiki/by-month/（${months.length} 个）`);
  console.log(`  按首字: private/wiki/by-letter/（${letterPages.length} 个）`);
  if (WITH_TERMS) console.log(`  词条页: private/wiki/terms/（${terms.length} 个）`);
}

main();
