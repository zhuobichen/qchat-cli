# sticker-explainer · Die-cut Sticker Explainer

An explainer fact card on a blue-grey dot grid: mouse stickers slap around a clay jar, a bar chart climbs to 48, then the camera zooms out and across to a wildcat sticker with a Felis lybica label. Stickers are procedurally painted photo-style cut-outs with a white die-cut border and drop shadow, and the camera follows a van Wijk-Nuij smooth zoom path. Stack: Python, numpy, OpenCV, Pillow, multiprocessing.

```bash
./render.sh <work_dir>
python3 <skill>/scripts/deliver.py --frames <work_dir>/frames --out clip.mp4
```

Needs Python 3.9+, numpy, opencv-python, Pillow, ffmpeg, and the macOS system fonts Helvetica Neue and DIN Alternate Bold.

---

# S14 贴纸科普 — B「MICE FOUND THE GRAIN → THEN THE WILDCAT ARRIVED」（英文讲解版）

## 为什么重做
原来的 B 是第三方日文讲解片（牛皮纸底上的贴纸村子、陶罐、老鼠和猫），画面里是日文字幕。需求是这一组的 B 换成英文讲解，原片没有英文版，这一支讲同一个故事的第三拍：老鼠找到了存粮，随后野猫来了。做成一张蓝灰底的科普事实卡，构图、贴纸和图表全部自绘，没有沿用原片的画面和角色。

## 节拍
0–0.5 s 陶罐贴纸拍下，左上角 03 THE GRAIN STORE 和大标题 MICE FOUND THE GRAIN 擦出｜0.4–1.5 s 五只老鼠贴纸依次拍在罐子周围｜0.8–1.6 s 图表标题、网格线自左向右画出｜1.2–3.1 s 五根柱子逐根长高（2、5、11、23、48），数值和右上角红色大计数器 0→48 跟着滚动｜0–2.8 s 镜头从 1.06 慢慢拉到 1.0｜2.8–5.8 s 镜头沿平滑缩放路径退到全画布总览（约 0.5 倍）再推进右半｜3.85–4.8 s 04 ENTER THE PREDATOR 和标题 THEN THE WILDCAT ARRIVED 擦出｜5.0 s 两只老鼠贴纸拍上｜5.78 s 虎斑野猫贴纸拍下，6.0 s 镜头轻震｜6.06–6.7 s 老鼠往右逃出画外｜6.38 s 引线从猫胸口画出｜6.52 s 拍上标签 Felis lybica · African wildcat｜6.95–7.6 s 补两行说明 Ancestor of today's house cats 和体貌特征｜5.8–8 s 匀速慢推。

## 画风对应（上游参考包 S14 配方：mg-styles-15 19-paperclip）
- 蓝灰底 #E9EEF2 加 40 单位点阵；界面只用三色加一个强调色：深靛（字、柱、坐标轴）、灰蓝（辅助字、网格）、红色强调（MICE、WILDCAT、最后一根柱、计数器、标签红点）。
- 贴纸是程序画的仿照片抠图：陶罐、老鼠、野猫各自分层上色，底色叠细噪声当毛发和陶土质感，再按遮罩模糊做左上受光的体积明暗。外面一圈约 10 px 的白色模切边：先闭运算抹平凹口，再膨胀，边缘一道极细的灰边，表面一道很淡的覆膜反光，底下小投影。
- 贴纸拍下：从放大 1.25–1.4 倍、倾斜、悬空落到原位，back.out 收尾；投影由远、虚、淡变成近、实、深；前 3 帧淡入，避免整张贴纸一帧蹦出。
- 图表精确：每只老鼠 7.4 px，柱高严格按数值成比例，网格每 10 只一条，数值是滚动整数；副标题写明 Illustrative counts，不冒充实测数据。
- 野猫按非洲野猫画：沙黄底毛、淡虎斑、额头 M 形纹、环纹尾巴加黑尾尖、绿黄眼、耳背偏红；老鼠突出大圆耳、尖嘴和长尾，小尺寸也认得出。
- 大画布约 3700×1200，镜头 30 fps 连续：开场慢拉远，过场用 van Wijk–Nuij 平滑缩放平移（先退到总览再推进，屏幕上的感知速度恒定），最后匀速慢推。

## 复现
- 依赖：Python 3.9+、numpy、opencv-python、Pillow；ffmpeg；macOS 系统字体 Helvetica Neue（Condensed Black、Bold、Medium、Bold Italic）、DIN Alternate Bold。
- 渲染（10 进程约 25 s，每个进程第一次用到时生成贴纸贴图）：
  ```bash
  ./render.sh <work_dir>
  python3 <skill>/scripts/deliver.py --frames <work_dir>/frames --out clip.mp4
  ```
- 只渲几帧看效果：`ONLY=0,90,180,239 JOBS=4 python3 scene.py <帧目录>`。
- cv2 装在用户 site-packages 里，不要加 `-I`。

## 已知限制
- QA 结果 pass_auto 为 true，跳变帧列表为空。最大帧差 6.58 出现在 6.52 s 标签拍下那两帧，属于设计。早期版本用直线横移（峰值约 31 px/帧），在 98–161 帧被成片标成跳变，猫和标签拍下的 172、196 帧也被标出；现已改成先退到总览再推进的平滑缩放路径，并给贴纸拍下加 3 帧淡入，全部消掉。
- 贴纸是程序画的仿照片插画，不是真实照片抠图；猫的虎斑是几笔粗条纹，近看偏卡通。
- 柱状图的数字是示意值（画面已标 Illustrative counts），不是考古统计。
- 总览那一段（约 4.0–4.6 s）界面字很小，只作为过场看全画布用。

## 模型声明
源码由 Claude Opus 5.5 编写并渲染。
