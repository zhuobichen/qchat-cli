# neon-synthwave · Neon Synthwave

A brandless 80s boombox floats ahead of the camera while both race down a magenta neon grid toward a segmented sunset; palms, light posts and wireframe mountains sweep past in parallax layers and a chrome NEON TAPE title slams in. The look is Blender EEVEE with real forward camera motion, motion blur and compositor Glare (Bloom + Streaks), then Pillow scanlines, RGB offset and subtitle. Stack: Blender 5.2, Python, numpy, Pillow.

```bash
./render.sh <work_dir>
python3 <skill>/scripts/deliver.py --frames <work_dir>/frames --out clip.mp4
```

Needs Blender 5.2 on PATH, Python 3.9+, numpy, Pillow, ffmpeg, and the macOS system fonts Arial Black and Avenir Next.

---

# S08 霓虹复古 Synthwave · B「NEON TAPE」（v2 前冲行驶版）

## 内容
一台无品牌 80 年代手提式磁带录放机（boombox）悬浮在镜头前方，与相机一起沿洋红霓虹网格高速前冲（30 单位/秒，从第 0 帧起持续行驶）。网格横线持续冲向镜头；路边近处青色霓虹立柱、中层路灯、中远与远处棕榈剪影三层依次掠过，形成近/中/远视差；线框山以 0.97 倍相机速度跟随（缓慢漂近），分段落日保持在无穷远不动。路线为轻微 S 形，相机在转弯处随横向加速度倾侧，叠加发动机式细微抖动；机身在前方悬浮、轻摆、随弯道倾侧。

约 1.2 s PLAY 键预备上提→压下过冲→锁定，指示灯亮；1.6 s 起双卷轴缓入转动（左盘出带变小、右盘收带变大），喇叭随节拍鼓动，电平柱亮起，落日条纹下移并随节拍提亮。2.7–5.3 s 机身拉开到更远处、相机从高机位降为低机位，露出落日与路旁层次；约 5 s「NEON TAPE」镀铬渐变大标题冲入并回弹，星芒扫过标题上沿；6 s 起顶部副标题「SIDE A · PLAY IT LOUD」淡入；6–8 s 继续行驶收尾。

## v2 修改（按卡尔审片意见：没有前进运动感）
- 相机真实沿网格前进（世界静止），网格/立柱/路灯/棕榈全部固定在世界坐标里，视差与运动模糊都是物理正确的。
- 新增三层路边元素：近处霓虹立柱（x≈±6.6）、中层路灯（±11）、棕榈剪影（±17–22 与 ±40–70）。
- 远山缓慢漂移、落日不动；弯道倾侧 + 细微抖动。
- 开启 EEVEE 运动模糊（快门 0.5、8 个时间步）。为此全部动画先逐帧打关键帧（线性插值）再渲染。
- 标题挂在相机坐标系中，保证行驶中保持清晰可读。

## 画风对齐 A
深紫夜空 + 星点、分段落日、青色线框山、洋红发光透视网格、棕榈剪影、路灯、镀铬多段渐变大标题 + 洋红侧边、双层辉光（Bloom）+ 星芒（Streaks）、轻扫描线与 1 px RGB 偏移。按需求不出现 VHS「PLAY ▶」与时间码等播放器 UI；不做 A 的汽车。

## 工具链与复现
- Blender 5.2.2 LTS（EEVEE，Standard 视图变换，48 TAA 采样，运动模糊 8 步，合成器 Glare：Bloom + Streaks）
- Python 3（numpy、Pillow）做后期扫描线、RGB 偏移与副标题
- FFmpeg 8.1（libx264 High, yuv420p, CRF 16）

```bash
./render.sh <work_dir>
python3 <skill>/scripts/deliver.py --frames <work_dir>/frames --out clip.mp4
```
单帧预览：`blender -b -P scene.py -- /tmp/s08 --frames 1,100,240 --pct 50 --samples 16`

## 素材来源与许可
- 全部几何（含棕榈）、材质、动画均为本次程序化生成，无下载素材、无第三方模型或贴图。
- 字体：macOS 系统字体 Arial Black（标题）、Avenir Next Demi Bold（副标题），仅用于渲染成画面，未分发字体文件。
- 风格参考：[mg-styles-15 10-synthwave](https://github.com/Vincentwei1021/mg-styles-15/blob/main/prompts/10-synthwave.md)（MG Styles 15，MIT），只用于理解画风；未复用其源码或视频画面。

## 模型声明
本片由 Claude Opus 5.5 在本次会话中编写源码并在本机 Blender 渲染。上游提示语中的原片模型/评分声明属于上游 A，与本片无关。

## 已知限制
- 已执行：清空帧目录后从当前 scene.py 完整渲染 240 帧；ffprobe 规格、FFmpeg 完整解码、逐帧运动差统计、0.5/2/4/6/7.5 s 抽帧与 A 上下对比、2 fps 全片缩略条审看、第 60/61 帧全分辨率连续帧检查（网格每帧前进约 1/3 格，无车轮倒转式混叠，近处立柱与横线有运动模糊）。未做实时连续播放审看。
- 逐帧平均差 17.5，高于 A 的 9.65（目标 ≥7）。原因是高对比洋红网格整幅持续前冲；如需更接近 A 的强度，可把 SPEED 从 30 降到约 18。
- 标题挂在相机上，行驶抖动与倾侧时标题保持屏幕稳定（不随路面晃），这是为 9:16 可读性做的取舍。
- 没有 A 的手写霓虹 script 第二行字；不做 A 的汽车（任务要求）。
- 机身下方地面有一块落日暖色反光，属于有意保留的湿地面反光。
