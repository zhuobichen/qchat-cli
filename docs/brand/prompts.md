# 品牌图提示词存档

这张图（`docs/images/brand.png`）是 MiniMax `image-01` 生成的，**文字由模型自己画**。

为什么要存提示词：生图这东西一次成不了，改风格、改字重、改配色全靠在同一句提示词上微调。
丢了提示词等于从头再来。每次 `node scripts/minimax-image.mjs` 都会自动追加一份到
`output/gen/prompts.jsonl`（含时间、模型、比例、完整提示词、产出文件名），这份文档是它的可读版本。

## 当前采用：v5

`docs/images/brand.png` ← `output/gen/logo-cp-5.jpg`（裁掉四周纯黑，统一宽 1600）

> 关键收获：**把字母一个一个念出来**（"letters q, c, h, a, t, hyphen, c, l, i"）+
> "all nine characters fully visible inside the frame, nothing cropped"，能明显降低截字/漏字的概率。
> v4 就是漏了 `-cli` 三个字母。

## 各版本对照

| 版本 | 风格 | 结果 |
|---|---|---|
| logo-cp-1 | 细霓虹描边，字偏细，图标小 | 赛博朋克 logo+文字 第1版 |
| logo-cp-2 | 胖赛博企鹅头 + 渐变字，最稳的一版 | 赛博朋克 v2：粗体块面字 + 大图标 |
| logo-cp-3 | 重铬边字最好看，但图标变成了瘟疫医生鸟头 | 赛博朋克 v3：超粗工业字 + 3D 挤出 |
| logo-cp-4 | 字被裁掉，只剩 qchat | 赛博朋克 v4：胖企鹅 + 重字重铬边（v2 的图标 + v3 的字） |
| logo-cp-5 | ★ 采用：胖赛博企鹅 + 完整九字符 + 重霓虹描边 | 赛博朋克 v5：胖企鹅 + 完整九字符 |

## 逐版提示词

### logo-cp-1

- 比例：`16:9`　模型：`image-01`　时间：2026-11-12T04:44:19.241Z
- 备注：赛博朋克 logo+文字 第1版

```text
Cyberpunk neon logo lockup on pure black background: on the left a stylized robotic penguin head icon made of chrome and circuit traces, glowing neon cyan and magenta rim light, subtle glitch scanlines; on the right the wordmark 'qchat-cli' in bold angular futuristic techno lettering with neon outline and slight chromatic aberration, perfectly spelled; only the icon and the wordmark, nothing else, generous empty space, high contrast, sharp vector-like rendering, 16:9 wide composition 赛博朋克 logo+文字 第1版
```

### logo-cp-2

- 比例：`3:2`　模型：`image-01`　时间：2026-11-12T04:44:54.255Z
- 备注：赛博朋克 v2：粗体块面字 + 大图标

```text
Cyberpunk logo lockup, 3:2 composition, pure black background. Left: a large glowing cybernetic penguin head built from brushed chrome panels and neon circuit seams, cyan and magenta rim light, tiny glitch pixels. Right: the wordmark 'qchat-cli' in a CHUNKY BOLD angular display typeface with thick slab strokes, metallic chrome fill, hot magenta and cyan neon outline, subtle chromatic aberration; bold poster-like typography, perfectly spelled, tightly kerned. Only icon and wordmark, balanced spacing, sharp, high contrast, no extra text 赛博朋克 v2：粗体块面字 + 大图标
```

### logo-cp-3

- 比例：`16:9`　模型：`image-01`　时间：2026-11-12T04:45:26.724Z
- 备注：赛博朋克 v3：超粗工业字 + 3D 挤出

```text
Cyberpunk logo lockup on black, 16:9. Left: cybernetic penguin head, chrome and carbon fiber, glowing cyan eye visor, magenta rim light, thin circuit lines. Right: 'qchat-cli' set in an ULTRA HEAVY BRUTALIST display face, thick squared strokes with cut corners and stencil gaps, chrome extrusion with bright cyan edge light and faint magenta glow, tight tracking, poster-grade typography, perfectly spelled. Nothing else in frame, dramatic contrast, crisp, high detail 赛博朋克 v3：超粗工业字 + 3D 挤出
```

### logo-cp-4

- 比例：`16:9`　模型：`image-01`　时间：2026-11-12T04:45:59.268Z
- 备注：赛博朋克 v4：胖企鹅 + 重字重铬边（v2 的图标 + v3 的字）

```text
Cyberpunk logo lockup on pure black, 16:9. Left: a CHUBBY cybernetic PENGUIN head (round body, small beak, glowing single cyan visor eye), black carbon-fiber panels with magenta neon seams, chrome highlights, thin circuit traces. Right: 'qchat-cli' in an ultra heavy rounded-square display face with chrome bevel and dual neon outline (cyan outside, magenta inside), tight tracking, poster-grade, perfectly spelled. Only the penguin head and the wordmark, nothing else, dramatic rim lighting, crisp edges, high contrast 赛博朋克 v4：胖企鹅 + 重字重铬边（v2 的图标 + v3 的字）
```

### logo-cp-5

- 比例：`16:9`　模型：`image-01`　时间：2026-11-12T04:46:30.967Z
- 备注：赛博朋克 v5：胖企鹅 + 完整九字符

```text
Cyberpunk logo lockup on pure black, wide 16:9. Left: chubby cybernetic PENGUIN head, black carbon panels, glowing cyan visor, magenta neon seams, chrome accents. Right: the FULL wordmark reading exactly 'qchat-cli' — letters q, c, h, a, t, hyphen, c, l, i — in an ultra heavy display face with chrome bevel and dual neon outline, all nine characters fully visible inside the frame, tight tracking, poster-grade typography, perfectly spelled, nothing cropped. Only penguin head and wordmark, dramatic rim light, crisp 赛博朋克 v5：胖企鹅 + 完整九字符
```

## 复用/改造建议

- 想换配色：只改颜色词（`cyan and magenta` → `acid green and violet`），其余别动，构图会跟着乱。
- 想换字体重量：改 `ultra heavy display face` / `chunky bold` / `thin neon outline` 这一句，
  别同时改构图，否则一版里两个变量，看不出是哪个起的作用。
- 想换比例：`--ar` 改就好，但 16:9 下字符最容易被裁，宽图要在提示词里强调 "nothing cropped"。
- 想加副标题：中文别让模型画（偏旁必崩），用 `scripts/make-brand.py` 那种 PIL 叠字更靠谱。
