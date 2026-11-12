import json
import re
import os

src = 'output/gen/prompts.jsonl'
rows = [json.loads(l) for l in open(src, encoding='utf-8') if l.strip()]

def clean(r):
    """早期版本 --note 没被排除，备注被拼进了提示词；渲染时剥掉。"""
    p = r['prompt']
    note = (r.get('note') or '').strip()
    if note and p.endswith(note):
        p = p[:-len(note)].rstrip()
    return p

logos = [r for r in rows if r['outputs'] and r['outputs'][0].startswith('logo-')]
archs = [r for r in rows if r['outputs'] and r['outputs'][0].startswith('arch-ai')]

logo_notes = {
    'logo-cp-1': '细霓虹描边，字偏细，图标小',
    'logo-cp-2': '胖赛博企鹅头 + 渐变字，最稳的一版',
    'logo-cp-3': '★ 采用：重铬边字最好看 + 瘟疫医生鸟头，最不像 QQ',
    'logo-cp-4': '字被裁掉，只剩 qchat（漏了 -cli）',
    'logo-cp-5': '胖企鹅 + 完整九字符，字略轻',
}

arch_rows = {
    'arch-ai-1': ('8 个模块名', '几乎全错：`ФС Sole 1`、`Ти Рюве` 这种鬼画符'),
    'arch-ai-2': ('5 个短词', '一半对：NapCat ✅ HTTP ✅，但冒出 `OMS`、`W9`、`LCE`'),
    'arch-ai-3': ('3 个巨字', '**全对**：NapCat / qce / storage，但只剩三个框，信息量不够'),
    'arch-ai-4': ('6 个中字', '六成对：QQ→Q⑵、两个 WS、qce 重复，还冒乱码'),
}

out = []
out.append('# 品牌图与架构图 · 提示词存档')
out.append('')
out.append('图都是 MiniMax `image-01` 生成的，**文字由模型自己画**，不再手工叠字。')
out.append('')
out.append('为什么要存提示词：生图上一次成不了，改字重、改配色、改构图全靠在同一句上微调；')
out.append('丢了提示词就等于从头抽卡。每次 `node scripts/minimax-image.mjs` 都会自动追加到')
out.append('`output/gen/prompts.jsonl`（时间 / 模型 / 比例 / 完整提示词 / 产物名），这份文档是它的可读版本。')
out.append('')
out.append('## 一、品牌图（logo + 文字）')
out.append('')
out.append('当前采用：**logo-cp-3** → `docs/images/brand.png`（裁掉四周纯黑，统一宽 1600）')
out.append('')
out.append('| 版本 | 结果 |')
out.append('|---|---|')
for r in logos:
    name = r['outputs'][0].rsplit('.', 1)[0]
    out.append(f"| {name} | {logo_notes.get(name, '')} |")
out.append('')
out.append('> 关键经验：**把字母一个一个念出来**（`letters q, c, h, a, t, hyphen, c, l, i`）')
out.append('> 加上 `all nine characters fully visible, nothing cropped`，能明显减少截字。')
out.append('> v4 就是漏了 `-cli` 三个字母。')
out.append('')
for r in logos:
    name = r['outputs'][0].rsplit('.', 1)[0]
    out.append(f"### {name}")
    out.append('')
    out.append(f"- 比例 `{r['aspect']}`　模型 `{r['model']}`　时间 {r['at']}")
    out.append('')
    out.append('```text')
    out.append(clean(r))
    out.append('```')
    out.append('')

out.append('---')
out.append('')
out.append('## 二、架构图：模型的文字能力不够，最后是混合方案')
out.append('')
out.append('连着试了几版让模型连文字一起画，结论很硬：**标签越多，符咒化越严重。**')
out.append('')
out.append('| 尝试 | 标签量 | 结果 |')
out.append('|---|---|---|')
for r in archs:
    name = r['outputs'][0].rsplit('.', 1)[0]
    q, res = arch_rows.get(name, ('?', '?'))
    out.append(f'| {name} | {q} | {res} |')
out.append('')
out.append('**规律：字越大、个数越少，越准。** 三个巨字能全对，六个中字就开始精神污染。')
out.append('')
out.append('所以 `docs/images/architecture.png` 走的是分工方案：')
out.append('')
out.append('1. **底图**（赛博背景、光晕质感）→ MiniMax 生成')
out.append('2. **霓虹框线 / 箭头 / 全部标签** → `scripts/make-architecture.py` 画，最后加 bloom 辉光')
out.append('')
out.append('模型管氛围，代码管事实。改组件名只要重跑脚本，不用重新抽卡。')
out.append('')
for r in archs:
    name = r['outputs'][0].rsplit('.', 1)[0]
    out.append(f"### {name}")
    out.append('')
    out.append('```text')
    out.append(clean(r))
    out.append('```')
    out.append('')
out.append('## 三、复用/改造建议')
out.append('')
out.append('- 换配色：只改颜色词（`cyan and magenta` → `acid green and violet`），构图别动。')
out.append('- 换字重：只改 `ultra heavy display face` / `chunky bold` / `thin neon outline` 这一句。')
out.append('- 一次只改一个变量，否则出问题看不出是哪个的锅。')
out.append('- 中文别让模型画：偏旁必崩，要中文副标题就用 PIL 叠（见 `scripts/make-brand.py`）。')
out.append('')

os.makedirs('docs/brand', exist_ok=True)
open('docs/brand/prompts.md', 'w', encoding='utf-8').write('\n'.join(out))
print('wrote', len(out), 'lines')
