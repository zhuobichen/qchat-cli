# soft-inflatable-3d · Soft Inflatable 3D

Mint-green inflatable letters G and O drop onto a cream quilted cushion, squash, bounce and jump again, then the caption BOUNCE BACK fades in. It is Blender EEVEE with glossy inflated skin, ray-traced reflections and motion blur, a 1200 Hz contact-physics integration for the squash and bounce, and numpy-driven cushion deformation; Pillow adds the caption. Stack: Blender 5.2, Python, numpy, Pillow.

```bash
./render.sh <work_dir>
python3 <skill>/scripts/deliver.py --frames <work_dir>/frames --out clip.mp4
```

Needs Blender 5.2 on PATH, Python 3.9+, numpy, Pillow, ffmpeg, and the macOS system fonts Arial Rounded Bold, Avenir Next and Hiragino Sans GB.

---

# S34 软体充气3D · B「GO」（v2 真实落体 + 快速回弹 + 互补色）

## 内容
薄荷玉绿的充气气球字母「G」「O」吊在暖奶油色绗缝充气软垫上方（开场字母顶部略出画）。0.55 s G 松开、0.78 s O 松开（错开约 0.23 s），各自以重力加速下落约 0.35 s；撞上软垫瞬间软垫在字母下方压陷、外圈被挤高，字母被压扁到约 0.56 倍高度，随即快速弹起；之后两次衰减回弹，约 0.9 s 内静止，压扁/拉伸带二次晃动，字母前后轻微摆动。约 4.05 / 4.18 s 两个字母先下蹲（软垫被压得更深）再一起跳起，落地后又是快速衰减回弹；约 6.05 / 6.22 s 各一次小跳后站稳。软垫上的接触软影随字母高度变化：越高越淡越大，落地时收紧变深。相机低机位缓慢绕行并推近（方位约 −24°→+12°），前后层次清楚。6.6 s 起淡入说明字「BOUNCE BACK / 弹 回 来」。与 A 的「soft」针垫内容不同。

## v2 修改（按卡尔审片意见）
- **配色改为 A 的互补色**：字母由玫粉改为高光薄荷/玉绿，背景由薰衣草紫改为淡奶油黄，软垫改为暖奶油色，针脚改为薄荷绿；说明字改为深玉绿。**这一条按卡尔要求偏离了原需求「保留 A 的主色体系、A/B 同画风统一配色」的规定**；材质语法（高光充气表皮、缝合线、柔光、绗缝软垫）不变。
- 运动改为真实物理：一维接触模型（重力 g=40 场景单位/秒²，单侧弹簧 K=965、阻尼 C=13.7，每单位质量）以 1200 Hz 数值积分。下落约 0.35 s，冲击压陷约 0.36，恢复系数约 0.47，两次衰减回弹在约 0.9 s 内结束，没有任何慢放。
- 压扁/拉伸由二阶弹簧（8.5 Hz，阻尼比 0.28）跟随目标形变，产生二次晃动；每次冲击叠加衰减的前后摆动。
- 接触软影：软垫着色器里每个字母一个椭圆软影，强度与大小随高度关键帧变化。
- 相机放低、加入绕行推近；开启 EEVEE 运动模糊（快门 0.5、8 个时间步），字母、相机与软影参数逐帧打关键帧（线性）。

## 运动模型细节
- 字母底部高度 h(t)、速度 v(t)、竖向缩放 sz(t) 来自上面的积分；下蹲 = 起跳前 0.12 s 额外向下的力 + 预压扁，起跳 = 设定初速度。
- 软垫中心位移 = min(h,0) + 每次离开接触后的向上自由阻尼振荡（6 Hz）。
- 软垫逐顶点位移 = 中心位移在 `t − 距离/6` 时刻的值 × 椭圆高斯核（减去外圈环形鼓起项）× 边缘轮廓，所以离接触点越远响应越晚，外圈先被挤高。numpy 每帧写回网格。

## 工具链与复现
- Blender 5.2.2 LTS（EEVEE，Standard 视图变换，光线追踪反射，48 TAA 采样，运动模糊 8 步）
- Python 3 + Pillow（结尾说明字）
- FFmpeg 8.1（libx264 High, yuv420p, CRF 16）

```bash
./render.sh <work_dir>
python3 <skill>/scripts/deliver.py --frames <work_dir>/frames --out clip.mp4
```

## 素材来源与许可
- 全部几何、材质、动画为本次程序化生成，无下载素材。
- 字体：macOS 系统字体 Arial Rounded Bold（生成字母几何）、Avenir Next Demi Bold 与 Hiragino Sans GB W6（说明字），仅用于渲染画面，未分发字体文件。
- 风格参考：[mg-styles-15 04-3d-render](https://github.com/Vincentwei1021/mg-styles-15/blob/main/prompts/04-3d-render.md)（MG Styles 15，MIT），只用于理解画风；未复用其源码或画面。

## 模型声明
本片由 Claude Opus 5.5 在本次会话中编写源码并在本机 Blender 渲染。上游提示语里的原片模型声明属于上游 A。

## 已知限制
- 已执行：清空帧目录后从当前 scene.py 完整渲染 240 帧；ffprobe 规格、FFmpeg 完整解码、逐帧运动差统计、0.5/2/4/6/7.5 s 抽帧与 A 上下对比、2 fps 全片缩略条审看、第 120–124 与 182–184 帧（QA 标出的大差值帧）逐帧检查——是起跳瞬间的快速运动 + 拉伸 + 运动模糊，不是跳帧。物理参数另用数值检查：下落 0.35 s、首次冲击压陷 0.36、恢复系数约 0.47、首次落地后约 0.9 s 静止。未做实时连续播放审看。
- **配色按卡尔要求改为 A 的互补色，偏离原需求「A/B 保持同一主色体系」**；在 30 画风播放顺序里，S34 的 A/B 主色现在互补，需在最终排序时重新核对。
- 逐帧平均差 1.99（v1 为 0.73，A 为 6.49）：A 有大量珠粒翻涌，B 的运动集中在两个字母、软垫与相机绕行。
- 开场字母顶部略出画（从画外高处落下，属有意取舍）；背景中上部有柔光高光区，接近白色。
- 软垫形变是解析近似（高斯核 + 距离延迟），不是体积守恒的真实软体模拟；软垫本身不参与运动模糊（字母、相机有）。
- 字母压入软垫的接触面由 0.05 的轻微下沉掩盖，极近距离可能看到浅交叠。
