/**
 * 把表情库变成 wiki。
 *
 * 表情库的形态和梗词库不一样：梗是文字，表情是图。
 * 所以 wiki 的价值在于「按语义找图」——label 里那些词（治愈/安慰/阴阳/猫）
 * 就是天然的分类轴，人翻起来比翻 963 个哈希文件名强。
 *
 * 产物：
 *   private/wiki/stickers/index.md            总览 + 标签导航
 *   private/wiki/stickers/by-tag/<tag>.md     一个标签一页，直接嵌图
 *   private/wiki/stickers/all.md              全部（按导入时间倒序）
 *
 * 图片用相对路径引到 ../../../emoji-library/<hash>.<ext>，
 * 在 Obsidian / VS Code 的 markdown 预览里能直接看到图。
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const LIB = path.join(ROOT, 'private', 'emoji-library');
const MANIFEST = path.join(LIB, 'manifest.json');
const OUT = path.join(ROOT, 'private', 'wiki', 'stickers');

const MIN_TAG_COUNT = 4;   // 少于 4 张的标签不单独建页
const MAX_TAGS_PER_STICKER = 4;

/**
 * 停用词：这些不是"语义标签"，是 label 生成时留下的填充词。
 * 实测不滤的话，最大的两个分类是「待标」172 张和「DeepSeek」157 张——
 * 一个表示"没标注"，一个是来源名，当分类毫无意义。
 */
const STOP = new Set([
  '待标', '表情包', '表情', '图片', '梗图', '素材', '收藏',
  'DeepSeek', 'deepseek', 'deepseek-flash', 'AI',
  '好的', '现在', '可以', '什么', '这个', '那个', '一个',
]);

function safeName(s) {
  return String(s).replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60);
}

/** label → 标签数组。分隔符很杂：中英文逗号、顿号、空格、斜杠都用过。 */
function tagsOf(label) {
  const parts = String(label ?? '')
    .split(/[，,、;；/\s]+/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 2 && x.length <= 8 && !STOP.has(x));
  return [...new Set(parts)].slice(0, MAX_TAGS_PER_STICKER);
}

/** hash → 真实文件名（manifest 里不存扩展名，得扫目录） */
function buildFileIndex() {
  const map = new Map();
  let names = [];
  try {
    names = fs.readdirSync(LIB);
  } catch {
    return map;
  }
  for (const n of names) {
    if (n.startsWith('manifest') || n.endsWith('.json')) continue;
    const dot = n.lastIndexOf('.');
    if (dot < 0) continue;
    map.set(n.slice(0, dot), n);
  }
  return map;
}

function main() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const emojis = manifest.emojis ?? [];
  const files = buildFileIndex();


  const rows = [];
  const byTag = new Map();
  let missing = 0;

  for (const e of emojis) {
    const file = files.get(e.file) ?? files.get(e.hash);
    if (!file) {
      missing += 1;
      continue;
    }
    const tags = tagsOf(e.label);
    const rec = {
      label: String(e.label ?? '').trim() || '(无标签)',
      file,
      img: '../../../emoji-library/' + file,   // 相对 wiki/stickers/by-tag/ 与 all.md
      imgFromIndex: '../../emoji-library/' + file,
      at: e.importedAt ?? '',
      tags,
    };
    rows.push(rec);
    for (const t of tags) {
      if (!byTag.has(t)) byTag.set(t, []);
      byTag.get(t).push(rec);
    }
  }

  rows.sort((a, b) => (a.at < b.at ? 1 : -1));   // 新导入的在前

  const bigTags = [...byTag.entries()]
    .filter(([, list]) => list.length >= MIN_TAG_COUNT)
    .sort((a, b) => b[1].length - a[1].length);

  // 不生成标签页。
  // 试过按 label 里的词切分类，结果切成「我能去」「你家吃饭吗」这种句子碎片，
  // 当分类没有意义——表情的 label 是整句描述，不是标签。
  // 找图改走搜索（面板里的「梗库检索」支持 kind=sticker）。

  // 全部
  const all = ['# 全部表情', '', `共 ${rows.length} 张，按导入时间倒序。`, ''];
  for (const r of rows) {
    all.push(`## ${r.label}`, '', `![表情](${r.img})`, '');
  }
  fs.writeFileSync(path.join(OUT, 'all.md'), all.join('\n'), 'utf8');

  // 总览
  const idx = [
    '# 表情库',
    '',
    `共 **${rows.length}** 张，来自群里收集 + 手动导入。`,
    '',
    '表情没有“名字”，只有描述性的 label。',
    '',
    '## 全部',
    '',
    `- [全部表情（${rows.length} 张）](all.md)`,
    '',
    '## 说明',
    '',
    '- 图片直接从 `private/emoji-library/` 引用，不复制，避免占两份空间。',
    '- 这里只是浏览用的快照；**要找图请在「朝闻录」面板里搜**（按 label 关键词匹配）。',
    '- label 是自动生成的整句描述，拆成标签意义不大，所以没做标签分类。',
  ];
  fs.writeFileSync(path.join(OUT, 'index.md'), idx.join('\n'), 'utf8');

  console.log(`完成：${rows.length} 张表情（无标签分类，靠搜索找图）`);
  if (missing) console.log(`  注意：${missing} 张在 manifest 里有记录但找不到图片文件`);
  console.log(`  总览: private/wiki/stickers/index.md`);
}

main();
