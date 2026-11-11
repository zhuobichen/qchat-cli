# flat-vector · Flat Vector

A one-take flat illustration: the sun pops in, the title types on, wheat rows grow, a farmer waves and grain pours into three clay jars while the camera pans from the field to the granary. It is solid-colour polygons with no gradients or outlines, animated with GSAP-style easing (back.out, elastic.out) computed in Python and 2x supersampled. Stack: Python, numpy, OpenCV, Pillow, multiprocessing.

```bash
./render.sh <work_dir>
python3 <skill>/scripts/deliver.py --frames <work_dir>/frames --out clip.mp4
```

Needs Python 3.9+, numpy, opencv-python, Pillow, ffmpeg, and the macOS system font SF Pro Rounded (/System/Library/Fonts/SFNSRounded.ttf).

---

# S07 扁平矢量 — B「10,000 YEARS AGO… PEOPLE BEGAN TO FARM」（英文讲解版）

## 为什么重做
原来的 B 是第三方日文讲解片（扁平插画的金字塔村落和陶罐），画面里是日文字幕。需求是这一组的 B 换成英文讲解，原片没有英文版，这一支讲同一个故事（猫为什么在一万年前搬进人类村子）的第一拍：人类开始种地、开始存粮。构图、角色和配色全部自绘，没有沿用原片的画面和人物。

## 节拍
0–0.9 s 太阳 elastic 弹出，标题 10,000 YEARS AGO… 逐字弹出（每字隔两帧）｜1.35–1.75 s 标题缩进左上角，黄色时间签横向擦出，盖到哪个字哪个字换深靛色｜1.7 s 底部字幕胶囊弹出 PEOPLE BEGAN TO FARM，镜头下移看田｜1.85–2.6 s 五条田垄依次从左擦出｜2.4–3.5 s 麦子一列列弹起，之后随风轻摆｜3.4–3.9 s 两间房子落地｜3.9–4.6 s 农人弹出招手｜3.7–5.9 s 镜头正弦缓动横移到粮仓｜5.1 s 字幕胶囊变宽，换成 …AND STORED THEIR GRAIN｜5.3–5.9 s 三只陶罐依次弹出｜5.7 s 粮筐落下｜6.0、6.7、7.4 s 粮筐预备回拉再倾倒，谷粒流进三只罐子，罐口粮堆鼓起，罐与罐之间粮筐弧线跳过去｜7.74–7.96 s 粮筐飞出画外，镜头慢推到 8 s。

## 画风对应（上游参考包 S07 配方：mg-styles-15 01-flat-vector）
- 纯色多边形，无渐变、无纹理、无描边；六个高饱和色相：钴蓝天空、薄荷绿地面、明黄太阳和麦子、珊瑚红屋顶和陶罐、奶油白墙和云、深靛字和门窗。每个色相最多再配一档更深的平涂色做体积（远山、侧墙、罐子暗面、田垄）。
- 一镜到底：整条场景摆在世界坐标里，镜头 30 fps 连续推拉平移，天空层和远山层带视差（0.18、0.6），太阳不会挡住左上角时间签。
- 动作用 GSAP 的缓动公式：入场 back.out（带约 10% 挤压拉伸），退场 back.in，太阳 elastic.out，运镜 power3.inOut 和正弦缓动；stagger 两帧。
- 同一时刻只有一个主体做主动作，顺序是太阳 → 标题 → 田垄 → 麦子 → 房子 → 农人 → 陶罐 → 粮筐；云、麦浪、太阳光芒、树冠只做背景微动，保证画面每帧都在动。
- 开场第一帧就是满屏蓝天绿地和太阳，接在莫奈和像素游戏之后能马上亮起来。
- PIL 2 倍超采样画多边形，再 INTER_AREA 缩回 1920×1080，边缘干净。

## 复现
- 依赖：Python 3.9+、numpy、opencv-python、Pillow；ffmpeg；macOS 系统字体 SF Pro Rounded（/System/Library/Fonts/SFNSRounded.ttf，可变字重取 Black）。
- 渲染（10 进程约 3 s）：
  ```bash
  ./render.sh <work_dir>
  python3 <skill>/scripts/deliver.py --frames <work_dir>/frames --out clip.mp4
  ```
- 只渲几帧看效果：`ONLY=0,45,120,190 JOBS=4 python3 scene.py <帧目录>`。
- cv2 装在用户 site-packages 里，不要加 `-I`。

## 已知限制
- QA 结果 pass_auto 为 true，跳变帧列表为空。最大帧差 6.96 在第 156 帧（5.17 s），是横移途中字幕胶囊变宽换句，属于设计；横移段其余帧差在 5–6 之间，是连续运镜，不是剪切。早期版本横移只用 1 s、字幕胶囊整体收走再弹出，曾在 130–157 帧被标成跳变，现已把横移拉长到 2.2 s、字幕改成胶囊变形换句来消掉。
- 人物只有一个简笔农人，没有表情动画；粮食倒进罐子用罐口粮堆鼓起来表示，看不到罐内液位。
- 横移段画面左边的农人和田会被切出画外，这是一镜到底的取舍。
- 农人肤色是珊瑚红的浅一档，严格算是第七个色值。

## 模型声明
源码由 Claude Opus 5.5 编写并渲染。
