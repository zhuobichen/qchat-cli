[English](./README.md) | **[中文](./README_zh.md)** | [日本語](./README_ja.md)

<img src="./assets/style-wall.webp" width="100%" alt="carl-motion 画风墙：29 种动效画风同时播放">

# carl-motion

**29 种动效画风，每种一段能直接复制的提示语。** 纸张拼贴、Synthwave、水墨、木刻、点云、黏土、孔版套印、玻璃拟态等等，每个画风都配 8 秒示例、提示语和最容易翻车的地方，其中 20 个连渲染示例的完整源码一起给。

装上 Skill，跟你的 Agent 说一句用孔版套印风格做我的主题就行：

```bash
npx skills add LearnPrompt/carl-motion
```

Claude Code 也可以按插件装：先 `/plugin marketplace add LearnPrompt/carl-motion`，再 `/plugin install carl-motion@carl-motion`。

## 目录

- [先试一次](#先试一次)
- [29 种画风](#29-种画风)
- [Skill](#skill)
- [模版和源码](#模版和源码)
- [示例是怎么做出来的](#示例是怎么做出来的)
- [上游 Skill 和参考](#上游-skill-和参考)
- [素材与许可](#素材与许可)
- [致谢](#致谢)
- [作者](#作者)

## 先试一次

第一次用什么都不用装。在下面的画风墙里挑一个顺眼的，点进去，复制提示语，把你的主题换成自己的内容，发给 Claude、ChatGPT 或者任何会写代码的模型，让它出 1920×1080、30 fps、8 秒的 MP4。效果不对就看那一页的容易失败的点，改完再跑一次。

## 29 种画风

顺序和我们剪的那支盘点视频一致，相邻两个画风的主色大致互补，换组的时候一眼就能看出变了。29 个里有 24 个能在这里直接动起来，剩下 5 个只有不能转载的第三方示例，页面里放的是来源链接。

<table>
<tr>
<td width="33%" valign="top" align="center"><a href="./docs/styles/retro-paper-collage.md"><img src="./assets/previews/retro-paper-collage.webp" width="260" alt="Retro Paper Collage"></a><br><b>01 · 复古纸张拼贴</b><br><sub>Retro Paper Collage</sub><br><sub>含源码</sub></td>
<td width="33%" valign="top" align="center"><a href="./docs/styles/product-ui-2-5d.md"><img src="./assets/posters/product-ui-2-5d.jpg" width="260" alt="Product UI 2.5D Camera"></a><br><b>02 · 产品界面2.5D运镜</b><br><sub>Product UI 2.5D Camera</sub><br><sub>提示语加来源</sub></td>
<td width="33%" valign="top" align="center"><a href="./docs/styles/neon-synthwave.md"><img src="./assets/previews/neon-synthwave.webp" width="260" alt="Neon Synthwave"></a><br><b>03 · 霓虹复古Synthwave</b><br><sub>Neon Synthwave</sub><br><sub>含源码</sub></td>
</tr>
<tr>
<td width="33%" valign="top" align="center"><a href="./docs/styles/hand-drawn-notes.md"><img src="./assets/posters/hand-drawn-notes.jpg" width="260" alt="Hand-drawn Paper Notes"></a><br><b>04 · 纸面手绘笔记</b><br><sub>Hand-drawn Paper Notes</sub><br><sub>提示语加来源</sub></td>
<td width="33%" valign="top" align="center"><a href="./docs/styles/watercolor.md"><img src="./assets/previews/watercolor.webp" width="260" alt="Watercolor"></a><br><b>05 · 水彩手绘</b><br><sub>Watercolor</sub><br><sub>含源码</sub></td>
<td width="33%" valign="top" align="center"><a href="./docs/styles/woodcut.md"><img src="./assets/previews/woodcut.webp" width="260" alt="Black-and-white Woodcut"></a><br><b>06 · 黑白木刻版画</b><br><sub>Black-and-white Woodcut</sub><br><sub>含源码</sub></td>
</tr>
<tr>
<td width="33%" valign="top" align="center"><a href="./docs/styles/soft-inflatable-3d.md"><img src="./assets/previews/soft-inflatable-3d.webp" width="260" alt="Soft Inflatable 3D"></a><br><b>07 · 软体充气3D</b><br><sub>Soft Inflatable 3D</sub><br><sub>含源码</sub></td>
<td width="33%" valign="top" align="center"><a href="./docs/styles/point-cloud-survey.md"><img src="./assets/previews/point-cloud-survey.webp" width="260" alt="Point-cloud Survey"></a><br><b>08 · 点云测绘／剥层</b><br><sub>Point-cloud Survey</sub><br><sub>含源码</sub></td>
<td width="33%" valign="top" align="center"><a href="./docs/styles/blueprint.md"><img src="./assets/previews/blueprint.webp" width="260" alt="Blueprint Drawing"></a><br><b>09 · 蓝图工程制图</b><br><sub>Blueprint Drawing</sub><br><sub>含源码</sub></td>
</tr>
<tr>
<td width="33%" valign="top" align="center"><a href="./docs/styles/sticker-explainer.md"><img src="./assets/previews/sticker-explainer.webp" width="260" alt="Die-cut Sticker Explainer"></a><br><b>10 · 贴纸科普</b><br><sub>Die-cut Sticker Explainer</sub><br><sub>含源码</sub></td>
<td width="33%" valign="top" align="center"><a href="./docs/styles/feature-3d-character.md"><img src="./assets/posters/feature-3d-character.jpg" width="260" alt="Feature-film 3D Character"></a><br><b>11 · 动画电影式3D角色</b><br><sub>Feature-film 3D Character</sub><br><sub>提示语加来源</sub></td>
<td width="33%" valign="top" align="center"><a href="./docs/styles/chinese-ink-wash.md"><img src="./assets/previews/chinese-ink-wash.webp" width="260" alt="Chinese Ink Wash"></a><br><b>12 · 中国水墨</b><br><sub>Chinese Ink Wash</sub><br><sub>含源码</sub></td>
</tr>
<tr>
<td width="33%" valign="top" align="center"><a href="./docs/styles/ascii-crt.md"><img src="./assets/previews/ascii-crt.webp" width="260" alt="ASCII Character Visuals"></a><br><b>13 · ASCII字符视觉</b><br><sub>ASCII Character Visuals</sub><br><sub>提示语加来源</sub></td>
<td width="33%" valign="top" align="center"><a href="./docs/styles/isometric-world.md"><img src="./assets/previews/isometric-world.webp" width="260" alt="Isometric 2.5D World"></a><br><b>14 · 等轴2.5D世界</b><br><sub>Isometric 2.5D World</sub><br><sub>提示语加来源</sub></td>
<td width="33%" valign="top" align="center"><a href="./docs/styles/van-gogh-impasto.md"><img src="./assets/previews/van-gogh-impasto.webp" width="260" alt="Van Gogh Impasto"></a><br><b>15 · 梵高厚涂油画</b><br><sub>Van Gogh Impasto</sub><br><sub>含源码</sub></td>
</tr>
<tr>
<td width="33%" valign="top" align="center"><a href="./docs/styles/psychedelic-shader.md"><img src="./assets/posters/psychedelic-shader.jpg" width="260" alt="Iridescent Psychedelic Shader"></a><br><b>16 · 虹彩迷幻Shader</b><br><sub>Iridescent Psychedelic Shader</sub><br><sub>提示语加来源</sub></td>
<td width="33%" valign="top" align="center"><a href="./docs/styles/claymation.md"><img src="./assets/previews/claymation.webp" width="260" alt="Claymation Stop-motion"></a><br><b>17 · 黏土定格</b><br><sub>Claymation Stop-motion</sub><br><sub>含源码</sub></td>
<td width="33%" valign="top" align="center"><a href="./docs/styles/pixel-game.md"><img src="./assets/posters/pixel-game.jpg" width="260" alt="Pixel Game"></a><br><b>18 · 像素游戏</b><br><sub>Pixel Game</sub><br><sub>提示语加来源</sub></td>
</tr>
<tr>
<td width="33%" valign="top" align="center"><a href="./docs/styles/flat-vector.md"><img src="./assets/previews/flat-vector.webp" width="260" alt="Flat Vector"></a><br><b>19 · 扁平矢量</b><br><sub>Flat Vector</sub><br><sub>含源码</sub></td>
<td width="33%" valign="top" align="center"><a href="./docs/styles/monet-impressionist.md"><img src="./assets/previews/monet-impressionist.webp" width="260" alt="Impressionist Oil (Monet)"></a><br><b>20 · 印象派油画／莫奈</b><br><sub>Impressionist Oil (Monet)</sub><br><sub>含源码</sub></td>
<td width="33%" valign="top" align="center"><a href="./docs/styles/particle-morph.md"><img src="./assets/previews/particle-morph.webp" width="260" alt="Particle Morph"></a><br><b>21 · 粒子聚散造型</b><br><sub>Particle Morph</sub><br><sub>含源码</sub></td>
</tr>
<tr>
<td width="33%" valign="top" align="center"><a href="./docs/styles/white-model-projection.md"><img src="./assets/previews/white-model-projection.webp" width="260" alt="White-model Projection"></a><br><b>22 · 实体白模投影</b><br><sub>White-model Projection</sub><br><sub>含源码</sub></td>
<td width="33%" valign="top" align="center"><a href="./docs/styles/egyptian-mural.md"><img src="./assets/previews/egyptian-mural.webp" width="260" alt="Ancient Egyptian Mural"></a><br><b>23 · 古埃及壁画</b><br><sub>Ancient Egyptian Mural</sub><br><sub>含源码</sub></td>
<td width="33%" valign="top" align="center"><a href="./docs/styles/exploded-view.md"><img src="./assets/previews/exploded-view.webp" width="260" alt="Product Exploded View"></a><br><b>24 · 产品爆炸拆解</b><br><sub>Product Exploded View</sub><br><sub>含源码</sub></td>
</tr>
<tr>
<td width="33%" valign="top" align="center"><a href="./docs/styles/editorial-dataviz.md"><img src="./assets/previews/editorial-dataviz.webp" width="260" alt="Editorial Paper Data Story"></a><br><b>25 · 纸面编辑式数据叙事</b><br><sub>Editorial Paper Data Story</sub><br><sub>提示语加来源</sub></td>
<td width="33%" valign="top" align="center"><a href="./docs/styles/glassmorphism-ui.md"><img src="./assets/previews/glassmorphism-ui.webp" width="260" alt="Glassmorphism UI"></a><br><b>26 · 玻璃拟态UI</b><br><sub>Glassmorphism UI</sub><br><sub>含源码</sub></td>
<td width="33%" valign="top" align="center"><a href="./docs/styles/brick-toy.md"><img src="./assets/previews/brick-toy.webp" width="260" alt="Brick Toy"></a><br><b>27 · 积木玩具</b><br><sub>Brick Toy</sub><br><sub>含源码</sub></td>
</tr>
<tr>
<td width="33%" valign="top" align="center"><a href="./docs/styles/risograph.md"><img src="./assets/previews/risograph.webp" width="260" alt="Risograph Print"></a><br><b>28 · Risograph孔版套印</b><br><sub>Risograph Print</sub><br><sub>含源码</sub></td>
<td width="33%" valign="top" align="center"><a href="./docs/styles/scifi-hud.md"><img src="./assets/previews/scifi-hud.webp" width="260" alt="Sci-fi Scan HUD"></a><br><b>29 · 科幻扫描HUD</b><br><sub>Sci-fi Scan HUD</sub><br><sub>提示语加来源</sub></td>
</tr>
</table>

## Skill

`carl-motion` 把这套画风库交给你的编程 Agent 用。你可以报画风名，也可以只描述感觉，比如扁平、暖色、手作感。Agent 会挑最接近的那一条，把你的主题填进提示语，对着已知的失败点检查一遍；这个画风在仓库里有源码的话，它会直接从那份引擎改起。每张卡都写明这个画风验证到哪一步（已实做、只有上游、还在研究），做完的片子要过同一道交付门禁。

| | 画风页 | Skill |
|---|---|---|
| 适合谁 | 所有人，不用安装 | 用 Claude Code、Codex 等编程 Agent 的人 |
| 怎么用 | 复制，换主题，粘贴 | `npx skills add LearnPrompt/carl-motion`，然后直接提要求 |
| 得到什么 | 一段提示语 | 提示语、渲染方案和对失败点的检查 |

## 模版和源码

**画风引擎。** 20 个画风附带渲染 B 的源码，统一 1920×1080、30 fps、240 帧，每个引擎的入口都一样，`./render.sh <工作目录>` 出 240 张 PNG，再交给 `scripts/deliver.py` 编码并给出红黄绿结论，开工前先用 `scripts/doctor.py <引擎>` 查依赖。约定写在 [scene-contract.md](skills/carl-motion/references/scene-contract.md)。

| 目录 | 画风 | 技术栈 |
|---|---|---|
| [`retro-paper-collage`](skills/carl-motion/scenes/retro-paper-collage) | 复古纸张拼贴 | Python (NumPy + OpenCV + Pillow) |
| [`neon-synthwave`](skills/carl-motion/scenes/neon-synthwave) | 霓虹复古Synthwave | Blender + Python |
| [`watercolor`](skills/carl-motion/scenes/watercolor) | 水彩手绘 | Python (NumPy + OpenCV + Pillow) |
| [`woodcut`](skills/carl-motion/scenes/woodcut) | 黑白木刻版画 | Python (NumPy + OpenCV + Pillow) |
| [`soft-inflatable-3d`](skills/carl-motion/scenes/soft-inflatable-3d) | 软体充气3D | Blender + Python |
| [`point-cloud-survey`](skills/carl-motion/scenes/point-cloud-survey) | 点云测绘／剥层 | Blender + Python |
| [`blueprint`](skills/carl-motion/scenes/blueprint) | 蓝图工程制图 | Python (NumPy + OpenCV + Pillow) |
| [`sticker-explainer`](skills/carl-motion/scenes/sticker-explainer) | 贴纸科普 | Python (NumPy + OpenCV + Pillow) |
| [`chinese-ink-wash`](skills/carl-motion/scenes/chinese-ink-wash) | 中国水墨 | Python (NumPy + OpenCV + Pillow) |
| [`huashu-portraits`](skills/carl-motion/scenes/huashu-portraits) | 梵高厚涂油画 / 印象派油画／莫奈 / 古埃及壁画 | Node + Canvas / headless Chrome |
| [`claymation`](skills/carl-motion/scenes/claymation) | 黏土定格 | Blender + Python |
| [`flat-vector`](skills/carl-motion/scenes/flat-vector) | 扁平矢量 | Python (NumPy + OpenCV + Pillow) |
| [`particle-morph`](skills/carl-motion/scenes/particle-morph) | 粒子聚散造型 | Python (NumPy + OpenCV + Pillow) |
| [`white-model-projection`](skills/carl-motion/scenes/white-model-projection) | 实体白模投影 | Blender + Python |
| [`exploded-view`](skills/carl-motion/scenes/exploded-view) | 产品爆炸拆解 | Blender + Python |
| [`glassmorphism-ui`](skills/carl-motion/scenes/glassmorphism-ui) | 玻璃拟态UI | Node + Canvas / headless Chrome |
| [`brick-toy`](skills/carl-motion/scenes/brick-toy) | 积木玩具 | Blender + Python |
| [`risograph`](skills/carl-motion/scenes/risograph) | Risograph孔版套印 | Python (NumPy + OpenCV + Pillow) |

**9:16 口播排版。** [`skills/carl-motion/pipeline/script_layout.py`](skills/carl-motion/pipeline/script_layout.py) 把同一画风的两段示例上下叠放，顶上一条常驻标题，底下结果前置：每组第 0 帧就亮出画风名和已经出到一半的提示语卡，剩下的像模型生成一样一段段冒出来，5.4 秒再加注意条。右边的机位框留给真人口播。

<img src="./assets/layout-9x16.jpg" width="300" alt="9:16 排版：A、B 上下叠放，底部是提示语卡和注意条">

**流水线。** [`skills/carl-motion/pipeline`](skills/carl-motion/pipeline) 里还有做那支视频用到的工具。`encode.sh` 把每支片编成同一规格，`qa.py` 查规格、黑帧和跳帧，`color_order_v4.py` 按互补色排画风顺序，`color_stitch_verify.py` 在拼好的成片上复测每个切点，`opener_salience.py` 在 CIELAB 里给开场候选打分。用法见它的 [README](skills/carl-motion/pipeline/README.md)。

## 示例是怎么做出来的

每个画风是一对 8 秒片。A 来自上游参考，B 是同一画风换个题材的第二个例子，让人看得出这个画风能迁移。20 支 B 是 Claude Opus 5.5 为这个仓库从零写代码渲染的，输入是风格提示语和 A 作参考；其中七支用各自的画风接力讲同一个小故事，猫是怎么住进最早的农人村子的。每支片都过同一套检查：1920×1080、30 fps、正好 240 帧、完整解码、没有黑帧，自动标出的跳帧逐个用眼睛看过。

## 上游 Skill 和参考

这套画风库建立在下面这些开源风格 Skill 和公开画廊之上，每个画风页都链回了对应的上游提示语。

[八个视频 Skill 来源与选用](skills/carl-motion/references/video-skill-sources.md)（2026-11-07 核对）补齐原帖清单、与本库的对应关系、WTT 当前名称，以及 archival-doc 未提供公开地址的缺口。新增参考不代表已安装或实测。

| 上游 | 我们用了什么 | 许可 |
|---|---|---|
| [lemomo-ai/lemo-opuscar](https://github.com/lemomo-ai/lemo-opuscar) | 29 个画风里 13 个的配方和演示片：蓝图、水彩、水墨、木刻、点云、白模、拆解、积木、孔版、ASCII、等轴、数据叙事、HUD | 提示语和代码 MIT，演示片 CC BY 4.0 |
| [Vincentwei1021/mg-styles-15](https://github.com/Vincentwei1021/mg-styles-15) | 拼贴、扁平矢量、贴纸科普、玻璃拟态、Synthwave、软体 3D、等轴、HUD 的风格提示语 | MIT（提示语和代码） |
| [alchaincyf/huashu-art-motion](https://github.com/alchaincyf/huashu-art-motion) | 古埃及、梵高、莫奈的绘画引擎，我们的 A 用它的源码重渲染 | MIT |
| [Vincentwei1021/video-shotcraft](https://github.com/Vincentwei1021/video-shotcraft) | 产品界面宣传片和孔版错位的参考 | 以上游为准 |
| [prompt-motion.com](https://prompt-motion.com) | 像素、黏土、3D 角色、手绘笔记、Shader、粒子、ASCII 的公开参考 | 只放链接 |
| [yasue.org 的 Opus 5.5 视频生成极限文章](https://en.yasue.org/article/pushing-opus-5-5-video-generation-limits) | 七支英文讲解 B 复述的猫进村故事 | 只放链接 |

## 素材与许可

代码、提示语和我们自己渲染的片段都按 MIT 发布，包括 `skills/` 下的全部内容，以及标了含源码的画风在 `assets/` 里的预览。另有四个画风的预览是 LemoLab 的演示片，按 CC BY 4.0 使用并在页面里署名。prompt-motion.com、X、yasue.org 和 video-shotcraft 的片段没有复制进仓库，页面里只放链接。9:16 示例帧里的 A 来自 huashu（MIT），B 是我们渲染的。

## 致谢

- [lemomo-ai/lemo-opuscar](https://github.com/lemomo-ai/lemo-opuscar)、[Vincentwei1021/mg-styles-15](https://github.com/Vincentwei1021/mg-styles-15)、[alchaincyf/huashu-art-motion](https://github.com/alchaincyf/huashu-art-motion) 开放了风格配方。
- [prompt-motion.com](https://prompt-motion.com) 和 [yasue.org](https://en.yasue.org/article/pushing-opus-5-5-video-generation-limits) 提供了公开参考。
- [LearnPrompt/awesome-seedance](https://github.com/LearnPrompt/awesome-seedance) 的画廊加 Skill 结构。

## 作者

**卡尔（@卡尔的AI沃茨）** 是 GoodCase 的发起人，也维护这个仓库。在字节、阿里、百度做了六年大模型研发后转做 AI 视频，几部 AI 短片上过央视和卫视，全网 50 万以上关注。可以在 [X @aiwarts](https://x.com/aiwarts) 或公众号 [卡尔的AI沃茨](https://mp.weixin.qq.com/s/bNtxe27sQfGVig40VCAd_Q) 找到他，合作和勘误发 [carl@goodcase.ai](mailto:carl@goodcase.ai)。
