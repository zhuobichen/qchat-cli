# particle-morph · Particle Morph

60,000 amber particles form a nebula, a village silhouette, a three-arm vortex, a sitting cat reaching toward a person, and finally the words MAYBE THE CAT CHOSE US, with a live locked-particle counter. Targets are sampled from rasterised masks; motion is nested spring interpolation with curl-noise drift, splatted with motion blur and multi-radius bloom entirely in numpy. Stack: Python, numpy, OpenCV, Pillow, multiprocessing.

```bash
./render.sh <work_dir>
python3 <skill>/scripts/deliver.py --frames <work_dir>/frames --out clip.mp4
```

Needs Python 3.9+, numpy, opencv-python, Pillow, ffmpeg, and the macOS system font Avenir Next.

---

# S35 粒子聚散造型 — B「MAYBE THE CAT CHOSE US」结尾（英文讲解版）

## 为什么重做
原来的 B 是第三方日文讲解片，标题和字幕都是日文，换进英文讲解组不合适。这一支只做同一故事的第 5 拍，也就是结尾那句 MAYBE THE CAT CHOSE US。粒子系统、目标形状和字幕都由代码生成，原片只用来看画风，村子和角色的造型是重新设计的。

## 节拍
0–0.8 s 两条旋臂的暖色星云逐渐亮起，右上计数从 0 开始｜0.15–1.9 s 星云聚成村子剪影（两座圆屋、三个陶罐、谷仓穹顶、麦穗，门洞窗洞挖空），计数涨到 60,000｜1.9–2.9 s 村子停住，只有呼吸漂移和闪烁｜2.85–3.9 s 村子从左到右被卷走，汇成三臂旋涡，计数回落到 0｜3.75–5.3 s 旋涡里的四万多颗粒子聚成坐着的猫和伸手的人｜4.95–6.0 s 剩下的粒子从旋涡飞出拼成 MAYBE…，到位后叠一层实体字｜5.85–6.9 s 再拼出 THE CAT CHOSE US｜6.9–8 s 全部锁定，轻微呼吸，停到结尾。

## 画风对应（上游参考包 S35 配方：粒子要多，形状要给定）
- 60,000 颗粒子，暖琥珀、金色、暖白、深橙四档颜色，2% 的粒子亮三倍当闪点；背景是冷色深蓝径向渐变加少量冷色星点。
- 每个目标形状都先画成实心遮罩（村子、猫和人、两行字幕），再从遮罩采样目标点，三成采在轮廓带上，让剪影边缘清楚。
- 运动是嵌套插值：星云 → 村子 → 旋涡 → 终形。每段每颗粒子错开起点，用带回弹的弹簧缓动，路径加垂直方向的弧形偏移；未锁定时叠大幅 curl noise 漂移，锁定后只剩约 2 px 的呼吸。
- 渲染全用 numpy：每帧三个子时刻做运动模糊，双线性 splat 进累加缓冲（bincount 加法混合），再叠 2、8、30 px 三层模糊做辉光，按亮度做指数色调映射保住琥珀色相。
- 右上角计数器显示当前锁定在形状里的粒子数，下面一条进度线同步伸缩，对应 A 参考片的大数字计数。

## 复现
- 依赖：Python 3.9+、numpy、opencv-python、Pillow；ffmpeg；macOS 系统字体 Avenir Next（Heavy、Demi Bold）。
- 渲染（8 进程约 35 s）：
  ```bash
  ./render.sh <work_dir>
  python3 <skill>/scripts/deliver.py --frames <work_dir>/frames --out clip.mp4
  ```
- 只渲几帧看效果（帧号从 0 起）：`ONLY=0,60,120,175,239 JOBS=5 python3 scene.py <帧目录>`。

## 已知限制
- QA 没有标出跳变帧（jump_frames 为空）；最暗一帧平均灰度约 24/255，没有黑帧。
- 村子停住的 1.9–2.9 s 和结尾 6.9–8 s 只有呼吸和闪烁，帧差很小（结尾最低 0.017），QA 只记到 1 对近静止帧，最长静止段 1 帧。
- 4.9–5.9 s 字幕粒子还在旋涡里打转，旋涡中心正好落在人和猫之间，这一秒人猫剪影会被光尘盖住一些。
- 聚拢途中的帧（如 1.0 s、3.5 s）是一片光雾，要等弹簧收住才看得出形状，这是聚散节奏的一部分。
- 粒子数是六万，不是参考片说的几十万；画面已经能读出实心剪影，再加只会更慢。
- 字幕为了缩小后可读，粒子到位后叠了一层实体字，不完全是纯粒子拼字。

## 模型声明
源码由 Claude Opus 5.5 编写并渲染。
