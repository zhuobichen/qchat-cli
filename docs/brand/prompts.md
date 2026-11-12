# 品牌图与架构图 · 提示词存档

图都是 MiniMax `image-01` 生成的，**文字由模型自己画**，不再手工叠字。

为什么要存提示词：生图上一次成不了，改字重、改配色、改构图全靠在同一句上微调；
丢了提示词就等于从头抽卡。每次 `node scripts/minimax-image.mjs` 都会自动追加到
`output/gen/prompts.jsonl`（时间 / 模型 / 比例 / 完整提示词 / 产物名），这份文档是它的可读版本。

## 一、品牌图（logo + 文字）

当前采用：**logo-cp-3** → `docs/images/brand.png`（裁掉四周纯黑，统一宽 1600）

| 版本 | 结果 |
|---|---|
| logo-cp-1 | 细霓虹描边，字偏细，图标小 |
| logo-cp-2 | 胖赛博企鹅头 + 渐变字，最稳的一版 |
| logo-cp-3 | ★ 采用：重铬边字最好看 + 瘟疫医生鸟头，最不像 QQ |
| logo-cp-4 | 字被裁掉，只剩 qchat（漏了 -cli） |
| logo-cp-5 | 胖企鹅 + 完整九字符，字略轻 |

> 关键经验：**把字母一个一个念出来**（`letters q, c, h, a, t, hyphen, c, l, i`）
> 加上 `all nine characters fully visible, nothing cropped`，能明显减少截字。
> v4 就是漏了 `-cli` 三个字母。

### logo-cp-1

- 比例 `16:9`　模型 `image-01`　时间 2026-11-12T04:44:19.241Z

```text
Cyberpunk neon logo lockup on pure black background: on the left a stylized robotic penguin head icon made of chrome and circuit traces, glowing neon cyan and magenta rim light, subtle glitch scanlines; on the right the wordmark 'qchat-cli' in bold angular futuristic techno lettering with neon outline and slight chromatic aberration, perfectly spelled; only the icon and the wordmark, nothing else, generous empty space, high contrast, sharp vector-like rendering, 16:9 wide composition
```

### logo-cp-2

- 比例 `3:2`　模型 `image-01`　时间 2026-11-12T04:44:54.255Z

```text
Cyberpunk logo lockup, 3:2 composition, pure black background. Left: a large glowing cybernetic penguin head built from brushed chrome panels and neon circuit seams, cyan and magenta rim light, tiny glitch pixels. Right: the wordmark 'qchat-cli' in a CHUNKY BOLD angular display typeface with thick slab strokes, metallic chrome fill, hot magenta and cyan neon outline, subtle chromatic aberration; bold poster-like typography, perfectly spelled, tightly kerned. Only icon and wordmark, balanced spacing, sharp, high contrast, no extra text
```

### logo-cp-3

- 比例 `16:9`　模型 `image-01`　时间 2026-11-12T04:45:26.724Z

```text
Cyberpunk logo lockup on black, 16:9. Left: cybernetic penguin head, chrome and carbon fiber, glowing cyan eye visor, magenta rim light, thin circuit lines. Right: 'qchat-cli' set in an ULTRA HEAVY BRUTALIST display face, thick squared strokes with cut corners and stencil gaps, chrome extrusion with bright cyan edge light and faint magenta glow, tight tracking, poster-grade typography, perfectly spelled. Nothing else in frame, dramatic contrast, crisp, high detail
```

### logo-cp-4

- 比例 `16:9`　模型 `image-01`　时间 2026-11-12T04:45:59.268Z

```text
Cyberpunk logo lockup on pure black, 16:9. Left: a CHUBBY cybernetic PENGUIN head (round body, small beak, glowing single cyan visor eye), black carbon-fiber panels with magenta neon seams, chrome highlights, thin circuit traces. Right: 'qchat-cli' in an ultra heavy rounded-square display face with chrome bevel and dual neon outline (cyan outside, magenta inside), tight tracking, poster-grade, perfectly spelled. Only the penguin head and the wordmark, nothing else, dramatic rim lighting, crisp edges, high contrast
```

### logo-cp-5

- 比例 `16:9`　模型 `image-01`　时间 2026-11-12T04:46:30.967Z

```text
Cyberpunk logo lockup on pure black, wide 16:9. Left: chubby cybernetic PENGUIN head, black carbon panels, glowing cyan visor, magenta neon seams, chrome accents. Right: the FULL wordmark reading exactly 'qchat-cli' — letters q, c, h, a, t, hyphen, c, l, i — in an ultra heavy display face with chrome bevel and dual neon outline, all nine characters fully visible inside the frame, tight tracking, poster-grade typography, perfectly spelled, nothing cropped. Only penguin head and wordmark, dramatic rim light, crisp
```

---

## 二、架构图：模型的文字能力不够，最后是混合方案

连着试了几版让模型连文字一起画，结论很硬：**标签越多，符咒化越严重。**

| 尝试 | 标签量 | 结果 |
|---|---|---|
| arch-ai-2 | 5 个短词 | 一半对：NapCat ✅ HTTP ✅，但冒出 `OMS`、`W9`、`LCE` |
| arch-ai-3 | 3 个巨字 | **全对**：NapCat / qce / storage，但只剩三个框，信息量不够 |
| arch-ai-4 | 6 个中字 | 六成对：QQ→Q⑵、两个 WS、qce 重复，还冒乱码 |

**规律：字越大、个数越少，越准。** 三个巨字能全对，六个中字就开始精神污染。

所以 `docs/images/architecture.png` 走的是分工方案：

1. **底图**（赛博背景、光晕质感）→ MiniMax 生成
2. **霓虹框线 / 箭头 / 全部标签** → `scripts/make-architecture.py` 画，最后加 bloom 辉光

模型管氛围，代码管事实。改组件名只要重跑脚本，不用重新抽卡。

### arch-ai-2

```text
Clean futuristic technical architecture diagram on pure black background, vertical flow, neon cyan outlined rounded boxes connected by thin glowing arrows, flat vector infographic, generous spacing. Exactly five text labels and nothing else, each spelled exactly as given: 'QQ' in the top box, 'NapCat' in the wide box below it, 'HTTP' and 'WS' in two small boxes side by side under NapCat, 'qce' in a large panel below them. The qce panel contains six small empty rounded squares with no writing. Under the panel, three empty boxes connected by arrows, no writing inside them. All text small, crisp, plain sans-serif English, no gibberish, no random letters, no extra words, dark cyberpunk palette
```

### arch-ai-3

```text
Minimal cyberpunk system diagram on black, HORIZONTAL flow left to right, wide 16:9 composition filling the frame. Three large glowing neon rounded rectangles in a row, connected by thick glowing arrows. VERY LARGE bold sans-serif white labels centered in each box, exactly these three words: 'NapCat' in the first box, 'qce' in the second box, 'storage' in the third box. Below the second box, three small empty neon outlines (no text). Nothing else in the frame, no other words, no gibberish, no numbers, crisp vector, high contrast, generous fill of the canvas
```

### arch-ai-4

```text
Cyberpunk layered architecture diagram on black, portrait-ish layout filling the whole 16:9 frame, six glowing neon boxes connected by glowing arrows top to bottom. Each box has ONE large bold sans-serif white word, spelled exactly: top box 'QQ', second wide box 'NapCat', two small boxes under it 'HTTP' and 'WS', one large panel 'qce', and at the bottom 'storage'. Inside the qce panel only empty neon squares with no text. Large legible typography, the words big enough to read at a glance, no other words, no numbers, no gibberish, crisp vector neon lines, balanced composition that fills the canvas
```

### 像素风这一轮（最终采用）

| 尝试 | 标签量 | 结果 |
|---|---|---|
| arch-pixel-1 | 0 个字（纯图标） | 画面很香：企鹅 → 方块 → 磁盘，但只是图标条，不是架构图 |
| arch-pixel-2 | 4 个大字 | **全对**：QQ / NapCat / qce / storage ——最终采用这版 |
| arch-pixel-3 | 6 个字 | 当场崩：`HarCat:`、`Haeat`、`OCIS`、`Fastt` |

结论没变：**4 个大字是这套模型的上限。** 所以架构图只画四层，
组件清单放 README 文字里——图负责一眼看懂，文字负责说清。

#### arch-pixel-1

```text
16-bit pixel art architecture diagram, retro game UI style, on a dark navy background. Three chunky pixel blocks connected left to right by pixel arrows: the first block is a small penguin monitor sprite, the second is a bigger block with tiny pixel chips inside, the third is a stack of pixel disk icons. Above the blocks there is ONE line of pixel-font text reading exactly 'qchat-cli'. Big visible pixels, limited palette (navy, cyan, magenta, cream), chunky black outlines, crisp nearest-neighbor pixels, no anti-aliasing, no extra words, no gibberish
```

#### arch-pixel-2

```text
Pixel art architecture diagram, 8-bit retro game UI, dark navy background with dithered texture. Four chunky pixel boxes arranged in a vertical stack, connected by thick pixel arrows pointing down. Each box contains ONE short English label in large pixel font, spelled exactly: top box 'QQ', second box 'NapCat', third (widest) box 'qce', bottom box 'storage'. Boxes have thick 3px dark outlines and light bevel highlights, palette limited to navy, cyan, magenta, cream. Big visible pixels, no anti-aliasing, no extra words, no numbers, no gibberish, balanced composition filling the frame
```

#### arch-pixel-3

```text
Pixel art architecture diagram, 8-bit retro game UI, deep navy starfield background. Vertical layered stack of six chunky pixel boxes with thick dark outlines and bevel highlights, connected by thick pixel arrows: 'QQ' at top, then a wide 'NapCat' box, then TWO small boxes side by side labelled 'HTTP' and 'WS', then a wide 'qce' box, then 'storage' at the bottom. Every label in large readable pixel font, spelled exactly, palette limited to navy, teal, magenta, cream. Big pixels, no anti-aliasing, no extra words, no numbers, no gibberish, composition centred and filling the frame
```

## 三、复用/改造建议

- 换配色：只改颜色词（`cyan and magenta` → `acid green and violet`），构图别动。
- 换字重：只改 `ultra heavy display face` / `chunky bold` / `thin neon outline` 这一句。
- 一次只改一个变量，否则出问题看不出是哪个的锅。
- 中文别让模型画：偏旁必崩，要中文副标题就用 PIL 叠（见 `scripts/make-brand.py`）。


---

## 四、架构图定稿：参考 weflow-cli 的横向色带版式

生图模型在架构图上反复翻车（见上面三张证据图），最后放弃让模型画架构图，改成**版式参考 + 代码生成**：

- 版式抄 weflow-cli 的 `docs/images/weflow-architecture.png`：通栏色带、标题行（分层名 + `|` 分隔的条目）、
  图标格、虚线边界框、箭头
- 生成脚本 `scripts/make-architecture-bands.py`（PIL，2 倍超采样再缩，边缘干净）

好处是改了组件名重跑一次就行，不用重新抽卡；坏处是这张图不再“模型生成”，
但它的作用是把事实说清楚，不是氛围图，所以这个取舍是值的。

品牌图（logo + 文字）仍然完全由模型生成——那部分要的是质感，文字只有九个字母，模型扛得住。
