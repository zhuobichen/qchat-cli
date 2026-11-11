# watercolor · Watercolor

A watercolor scene on warm cotton paper: sky washes, mud-brick houses, a clay jar and reeds are painted stroke by stroke while mice creep to a grain heap and a tabby wildcat steps out of the reeds, with handwritten captions. Strokes are variable-width ribbons with per-bristle pigment and dry-brush gaps, composited by transmission (paper times exp(-density)) with edge pooling, granulation and drying. Stack: Python, numpy, OpenCV, Pillow, multiprocessing.

```bash
./render.sh <work_dir>
python3 <skill>/scripts/deliver.py --frames <work_dir>/frames --out clip.mp4
```

Needs Python 3.9+, numpy, opencv-python, Pillow, ffmpeg, and the macOS system font Bradley Hand Bold.

---

# S19 水彩手绘 — B「STORED GRAIN DREW MICE / THEN CAME THE WILDCAT」（英文讲解版，节拍 2）

## 为什么重做
原来的 B 是第三方日文讲解片（水彩画的村子、陶罐和猫），画面带日文字幕。需求是换成英文讲解，这一支只讲整个故事的第 2 拍：存粮招来老鼠，然后野猫来了。原片只拿来看画风，构图、角色和素材全部自绘，没有照搬原片的画面和排布。

## 节拍
0–0.8 s 暖白棉纸上，天空两道湿笔从左往右扫开，太阳留白后点上｜0.3–1.3 s 远山、沙地一道道叠下来｜0.7–1.6 s 泥砖房、陶罐、芦苇逐笔画出，0.65 s 起手写字幕 STORED GRAIN DREW MICE｜1.6–4.2 s 四只老鼠一走一停溜向谷堆，到了就低头啃｜3.95–4.4 s 字幕薄雾擦除，4.3 s 起写出 THEN CAME THE WILDCAT｜4.0 s 起芦苇被拨动，4.3–6.6 s 虎斑野猫从右边芦苇里走出来、减速停下｜5.0 s 老鼠停住竖耳，最右边一只回头｜6.05 s 引线画出，6.3 s 手写批注 wildcat · Felis lybica｜6.5–8 s 猫低头盯着老鼠，尾巴摆、芦苇晃、镜头继续推近 3.5%。

## 画风对应（上游参考包 S19 配方：透明笔触叠色、飞白、纸白当高光、逐笔上色）
- 一切都是笔触：沿路径做变宽色带，再叠一组刷毛轨迹，每根刷毛有自己的墨量、断续和枯竭点；干笔时色带提前收掉，只剩刷毛，出飞白。天空、地面、陶罐、猫身都是宽笔触，没有矢量平涂色块。
- 颜料按透射叠加：画面 = 纸色 × exp(−浓度 × 吸收)，两笔交叠处自然更深，颜色透明。
- 每笔上纸后做水彩处理：边缘积色、低频积水不匀、纸纹颗粒沉淀、湿笔外晕；天空和地面的回流花在晾干时长出来；刚画的笔触偏深，0.8 s 内晾干变浅。
- 纸白当高光：云、太阳底、陶罐高光、猫胸口都是从浓度里提白。
- 猫和老鼠先在背景里留白再上色；同一角色同色的几笔先并成一块再上色，只在外沿积色，内部不起接缝。
- 手写字用 Bradley Hand 粗体，深褐墨，从左往右写出；字幕底下是一笔浅赭色带。

## 复现
- 依赖：Python 3.9+、numpy、opencv-python、Pillow；ffmpeg；macOS 系统字体 Bradley Hand Bold。
- 渲染（8 进程约 20 s）：
  ```bash
  ./render.sh <work_dir>
  python3 <skill>/scripts/deliver.py --frames <work_dir>/frames --out clip.mp4
  ```
- 只渲几帧看效果：`ONLY=30,90,165,210 JOBS=4 python3 scene.py <帧目录>`（帧号从 0 起，文件名从 0001 起）。

## 已知限制
- QA 没有标出跳变帧（jump_frames 为空）；全片没有切镜，字幕换句用薄雾擦除，最大帧差 1.46。
- 第 1 帧是空白纸面，天空从第 1 帧开始往右扫，不算黑帧也不算静止。
- 猫是几笔拼出来的侧身走姿，腿偏直，走路只有摆腿和身体起伏，没有原片角色那样细的表情。
- 颗粒沉淀和纸纹比 A 稍重，整体饱和度也比 A 略高。
- 批注 wildcat · Felis lybica 是辅助标注，大写字母高约 36 px，比主字幕（约 45 px）小一档。

## 模型声明
源码由 Claude Opus 5.5 编写并渲染。
