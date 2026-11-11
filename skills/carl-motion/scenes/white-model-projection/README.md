# white-model-projection · White-model Projection

A white architectural model of an imagined 999-building city district is lit by a video projector: the old factory glows orange, a cool-white light front traces its conversion into a public library, and a walkable-reach layer spreads to neighbouring blocks. Colour comes only from projector light: Python draws a 4096-px projection map per frame, then Blender EEVEE renders a room-light pass and a projector-spotlight pass that are added in linear space and finished with glow, vignette and type. Stack: Blender 5.2, Python, numpy, Pillow.

```bash
./render.sh <work_dir>
python3 <skill>/scripts/deliver.py --frames <work_dir>/frames --out clip.mp4
```

Needs Blender 5.2 on PATH, Python 3.9+, numpy, Pillow, ffmpeg, and the macOS system fonts Hiragino Sans GB and Helvetica Neue.

---

# S28 实体白模投影 — B「老工厂 → 公共图书馆」（v2 精度重做）

## 内容
与 A（鹿特丹市中心按建成年代逐层点亮）不同的新内容。一整片 1:1000 示意城区白模立在深色展台上，老工厂是视觉焦点：
- 城区：9×9 街网切出 66 个街区，沿街周边式排布 999 栋程序化建筑（平顶 / 双坡 / 塔楼三类，高度、开间、进深随机；平顶上 1–3 个屋顶机房），2 处公园，432 棵带树干的球形树（行道树、公园、滨河），一条弯曲河道切开底板，两座带桥墩的桥，滨水石岸。
- 工厂（中央超级街区）：两座锯齿屋顶厂房、仓库、锅炉房、烟囱、办公楼、堆场。

动作：房间灯先照亮全白模型，0.85 s 切暗、投影机闪烁启动；橙色旧厂房亮起；冷白光头沿改造路线推进，庭院、阅览室、少儿区、屋顶花园依次点亮；最后一圈步行可达示意层从工厂向外扩散，周边街区按近 / 中 / 远三档亮起（约两成建筑保持不亮，避免满屏同色）。镜头全程缓慢绕行并推近，从全城区推到工厂。

| 时间 | 动作 |
|---|---|
| 0–1 s | 白模 + 展台，房间灯照明，可见整片城区 |
| 1–3 s | 切暗，投影机启动，线稿底图与旧厂房（橙）亮起；读数 01 旧厂区 |
| 3–5.5 s | 光带沿改造路线推进，公共空间逐块点亮；读数 02 改造路径；图钉 阅览室 / 屋顶花园 |
| 4.4–8 s | 步行可达示意层向外扩散到周边街区；读数 03 公共空间 + 近/中/远图例；字幕收束 |

## 精度如何提升（相对 v1）
| 项 | v1 | v2 |
|---|---|---|
| 场景 | 单座工厂 + 少量街区 | 整片城区：999 栋建筑 + 66 街区 + 河道 + 2 桥 + 432 棵树，约 5 万面 |
| 投影图 | 2048²，软化多边形 | 4096²，硬边多边形；静态线稿层：街区路缘线、屋顶轮廓、水面 0° 排线、公园 45° 排线、内院 −45° 排线 |
| 投影阴影 | 最大分辨率 0.0004、软半径 0.004、步数 8 | 最大分辨率 0.00012（约 3.3 倍精细）、软半径 0.002、步数 12，阴影池 1024 MB |
| 采样 | 28 | 32（交付版；脚本默认 40） |
| 镜头 | 浅角度绕行 | 距离 3.25 → 1.65 慢推 + 航向 −30° → +10° 绕行，俯角 41° → 32°，细节在推近时逐级读出 |
| 可读性 | — | 左侧读数加渐变底，左上身份标签加椭圆压暗底，亮楼群上小字仍可读 |

## 画风要点如何满足
- 主体始终是哑光全白实体；颜色不写进材质，只来自投影机光。
- 投影遮挡真实：投影遍只开一盏投影聚光灯（EEVEE 阴影贴图），面向投影机的面亮、背向面暗、被遮挡处无光。
- 字：身份标签、左侧读数大字、两枚图钉、近/中/远图例、居中双语字幕；无数字、无伪造数据。

## 渲染方法（两遍相加）
1. `project.py`：按投影机针孔模型（与场景共用 `layout.py` 的基向量）逐帧画 4096² 投影图（静态线稿层 + 逐帧填色）。
2. `scene.py`（Blender 5.2 EEVEE）每帧两遍：base（房间灯，白材质）；proj（只开投影聚光灯，材质反照率 = 按投影机视锥采样投影图）。
3. `overlay.py`：两遍在线性空间相加 → 高光辉光、暗角、轻颗粒 → 叠字。
最初尝试 Cycles 带贴图聚光灯，多进程共用 GPU 时每帧约 3.5 分钟，改为等价的 EEVEE 两遍。

投影图约 1 分钟 + 两遍渲染约 20 分钟（M4，另有 2–3 个渲染并行时实测）+ 合成约 1.5 分钟：

```bash
./render.sh <work_dir>
python3 <skill>/scripts/deliver.py --frames <work_dir>/frames --out clip.mp4
```

## 文件
- `layout.py`：城区与工厂布局、河道、街网、公共空间配色、步行可达三色、投影机位置与映射函数。
- `project.py`：逐帧投影图。用法 `python3 project.py <out> [start end]`。
- `scene.py`：白模几何、展台、灯光、投影材质、相机、两遍渲染、图钉锚点 meta。
- `overlay.py`：合成与叠字。
- `render.sh`：一键复现（固定交付参数 100% / 32 采样）。

## 素材来源与许可
- 无外部资产；全部几何与投影图由本目录源码生成（随机种子固定，可逐帧复现）。
- 城区与工厂都是**虚构示意**，不是任何真实地点；不含尺度、年份、面积等数值。步行可达层是示意分档，不是计算结果，画面图例写明“示意 / illustrative”。上游 STYLE 要求的“真实开放建筑数据 + FACTS.md”不适用于虚构示意。
- 字体：macOS 系统字体 Hiragino Sans GB、Helvetica Neue，仅本机栅格化，未分发字体文件。
- 风格语法参考：[lemo-opuscar white-model](https://github.com/lemomo-ai/lemo-opuscar/tree/main/styles/white-model)（lemo-opuscar white-model STYLE，MIT）。未复制 A 的画面、数据、配色表或版式文字。

## 已知限制
- 城区用的是程序化盒体（平顶 / 双坡 / 塔楼 + 屋顶机房），没有 A 那种来自真实建筑数据的不规则平面；单栋形体仍比真实开放数据简单。
- 投影阴影来自 EEVEE 阴影贴图，不是路径追踪；推到最近时屋檐下的接缝仍比 Cycles 软一点。
- 32 采样下暗部有轻微颗粒，后期另加了均匀颗粒统一质感。
- 投影启动闪烁（第 31–35 帧）是设计内效果；v2 的自动 QA 未把它判为跳变。
- 步行可达层只分三档，不是连续色带。

## 模型声明
本片由 Claude Opus 5.5 在本次会话中编写源码并在本机实际渲染。上游提示语中的原作模型/工具链声明属于 A 的来源，不是本片的调用记录。
