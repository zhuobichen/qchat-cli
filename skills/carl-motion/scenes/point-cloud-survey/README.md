# point-cloud-survey · Point-cloud Survey

A synthetic forest point cloud is peeled layer by layer by a descending cutting plane, revealing castle foundations, towers and a standing stone arch; a front then condenses the ground returns into a lit solid surface and amber outlines trace the walls. All data is procedurally generated illustrative data (about 570k points), rendered as point sprites in Blender EEVEE with Pillow glow, vignette and instrument overlay. Stack: Blender 5.2, Python, numpy, Pillow. Encode with --crf 19 because the point noise needs the extra bits.

```bash
./render.sh <work_dir>
python3 <skill>/scripts/deliver.py --frames <work_dir>/frames --out clip.mp4 --crf 19
```

Needs Blender 5.2 on PATH, Python 3.9+, numpy, Pillow, ffmpeg, and the macOS system fonts Hiragino Sans GB, Helvetica Neue and Menlo.

---

# S27 点云测绘／剥层 — B「林下古堡（示意）」

## 内容
与 A（康涅狄格州林下旧农田，真实 USGS 点云）不同的新内容：一片合成的林地点云，切割平面按台阶下移，把植被回波逐层抬起、消隐；树下露出古堡墙基、四角圆塔、内堡、隔墙、护城壕与一座站立的石拱门；随后一道前沿横扫，地面回波在原位凝结成雷光侧照的实体地表；最后镜头沿墙基缓慢绕行，琥珀色描线按长度依次点亮墙基，仅有一条示意标注指向拱门。

| 时间 | 动作 |
|---|---|
| 0–1 s | 完整稀疏点云（地面回波按航带扫描行排列，树冠回波按高度呈淡绿） |
| 1–4 s | 切割平面四段缓动下移；被越过的植被点原地上浮 ≤1.6 m 并消隐，平面与树相交处一圈冷白亮环；右侧标尺同步 |
| 4–6 s | 前沿沿 x 方向推进，前沿前的点变亮，前沿后点云凝结成同位置实体（含拱门实体） |
| 6–8 s | 继续绕行；墙基琥珀描线依次点亮；拱门示意标注弹出 |

镜头为 Catmull-Rom 连续样条（目标/距离/航向/俯仰），全片不停。

## 数据声明（重要）
**全部为程序生成的合成示意数据**，不是任何真实测区：没有坐标、地名、点数、测量数值或考古结论。画面左上角仪器信息即写明“合成示意点云 · Synthetic illustrative scan”；标尺不标数值；标注写“拱门遗构（示意）/ Arch remains · illustrative”。

## 工具链与复现
- Blender 5.2.2 LTS（EEVEE），Python + NumPy（Blender 自带）；固定随机种子，逐帧确定性。
- 系统 python3 + Pillow + NumPy（后期叠字、辉光、暗角）。
- FFmpeg 8.1.1（libx264）。

渲染约 12–20 分钟（M4，视 GPU 占用）。`render.sh` 内部先用 Blender 渲出 240 张原始帧和 meta（拱门顶屏幕坐标），再由 `overlay.py` 叠字与后期。点云噪点多，编码用 CRF 19（约 38 MB）：

```bash
./render.sh <work_dir>
python3 <skill>/scripts/deliver.py --frames <work_dir>/frames --out clip.mp4 --crf 19
```
预览：`blender -b -P scene.py -- <dir> 0 239 40 50`（每 40 帧取一帧、50% 分辨率）。

## 文件
- `scene.py`：地形/墙基/拱门几何、≈57 万点合成点云、剥层与凝结时间线、相机、逐帧渲染。
- `overlay.py`：辉光（仅高阈值前沿/描线）、暗角、仪器信息、切割平面标尺、左下双语字幕、拱门标注。
- `render.sh`：一键复现。

## 素材来源与许可
- 无外部资产：地形、点云、拱门、描线全部程序生成（本目录源码）。
- 字体：macOS 系统字体 Hiragino Sans GB、Helvetica Neue、Menlo，仅在本机渲染栅格化进画面，未随包分发字体文件。
- 风格语法参考：[lemo-opuscar lidar-survey](https://github.com/lemomo-ai/lemo-opuscar/tree/main/styles/lidar-survey)（lemo-opuscar LiDAR Survey STYLE，MIT）。未复制 A 的任何画面、数据、版式文字。

## 相对上游/A 的修改说明
- 上游要求“真实回波、真实测区”；本片无可核实许可的公开点云可用，按需求改为合成示意，并在画面与此处明确标注。
- 上游 Web/GL 管线改为 Blender 离线渲染；EEVEE 点云以小方形精灵渲染（直径约 2–5 px），配合 24 采样抗锯齿，近似上游的“软圆点”。
- 辉光与暗角在后期做（Blender 5.x 合成器 API 变动，后期更可控）。

## 已知限制
- 点的形状为 EEVEE 点云精灵而非严格软圆盘；近景可见轻微方形感。
- 地形微起伏为程序噪声，质感接近 A 的晕渲但不是真实 DEM 的随机性。
- 收尾镜头比 A 稍远（A 结束时贴近地表）；为保证 9:16 中层可读，主体保持在画面中部。

## 模型声明
本片由 Claude Opus 5.5 在本次会话中编写源码并在本机实际渲染。上游提示语中提到的原作模型/工具链属于 A 的来源信息，不是本片的实际调用记录。
