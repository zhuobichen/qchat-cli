# blueprint · Blueprint Drawing

An 8 s Prussian-blue engineering drawing that draws itself: a granary, storage jars, house mice and a wildcat appear stroke by stroke, with dimension lines, numbered balloons, a magnified detail circle and a title block. It is pure 2D vector work redrawn every frame in code (arc-length pen strokes, dashed and dash-dot lines, 45-degree section hatching, cyanotype paper noise), and the camera only pans and zooms. Stack: Python, numpy, OpenCV, Pillow, multiprocessing.

```bash
./render.sh <work_dir>
python3 <skill>/scripts/deliver.py --frames <work_dir>/frames --out clip.mp4
```

Needs Python 3.9+, numpy, opencv-python, Pillow, ffmpeg, and the macOS system fonts DIN Alternate Bold and DIN Condensed Bold.

---

# S04 蓝图工程制图 — B「Why cats moved in」猫与谷仓系统图（英文讲解版）

## 为什么重做
原来的 B 是第三方日文讲解片，字幕是日文，换进英文讲解组不合适。这一支用同一个故事（猫为什么在一万年前住进人类村子）重新画了一张工程图纸，只讲猫、老鼠、谷仓这一拍。构图、角色和所有线稿都是代码自绘，原片只看了画风，没有照搬它的版式和角色。

## 节拍
0–0.7 s 图框双线、分区刻度、地面线先画出，左上图题条打字 FIG. 1 — GRANARY, c. 8000 BCE｜0.3–1.9 s 圆屋墙体、锥形屋顶、门洞、砖缝、茅草线依次画出｜0.9–2.5 s 三个陶罐，中间一个做半剖面（内壁、剖面斜线、点划中心线、谷粒）｜2.0–2.9 s 尺寸线 Ø 0.5 m、1.1 m 和编号气泡 1 HUT、2 STORAGE JAR、3 GRAIN · SECTION A–A｜2.85–3.6 s 图题换成 FIG. 2 — MOUSE (Mus musculus)｜3.0–4.3 s 四只老鼠逐只画出，引线汇到 HOUSE MOUSE 标注，QTY 从 01 跳到 04｜3.95–4.9 s 罐顶老鼠圈出 B，右上画 DETAIL B · 2 : 1 放大圆｜4.65–5.3 s 图题换成 FIG. 3 — WILDCAT (Felis lybica)｜4.8–6.4 s 野猫侧视外轮廓一笔画完，再画眼鼻胡须、虎斑条纹、尾环和深色尾尖｜6.05 s 气泡 5 WILDCAT · Felis lybica｜6.25–6.8 s 虚线箭头从猫鼻子划向谷仓，标 REACHES THE GRANARY｜6.6–7.5 s 右下画图框 WHY CATS MOVED IN · SHEET 1 OF 1｜7.3–8 s 镜头拉到整张图纸并继续极慢拉远。

镜头全程只平移和缩放：FIG.1 停在谷仓左侧（1.32 倍），FIG.2 移到老鼠和放大圆（1.3 倍），FIG.3 移到猫（1.28 倍），最后拉远到 1.0 倍看全图。

## 画风对应（上游参考包 S04 配方：lemo blueprint）
- 普鲁士蓝晒图纸：底色加低频曝光不匀、中频斑驳、细颗粒和横竖两道折痕；网格每 20 单位一条细线、每 100 单位一条粗线，每帧按矢量重画，推近时不会糊。
- 白色细线按绘图顺序逐笔画出：每条折线有起止时间，按弧长推进，笔尖有一个白点；虚线、点划线在弧长上切段；箭头画完后才填实。
- 尺寸线带尺寸界线和双箭头，编号气泡带引线和落点小圆点，剖面用 45° 斜线，中心线用点划线，右下角是标准 title block。
- 只用蓝白两色、只做 2D：没有发光、没有 3D 线框、没有渐变色，墨线只有 1.6 px 的轻微晕开。
- 猫和老鼠先用椭圆、多边形和粗线拼成实心遮罩，再取外轮廓当一笔画；条纹、尾环用遮罩裁剪只留在身体里，放大圆里的老鼠用圆形裁剪。

## 复现
- 依赖：Python 3.9+、numpy、opencv-python、Pillow；ffmpeg；macOS 系统字体 DIN Alternate Bold、DIN Condensed Bold。
- 渲染（8 进程约 12 s）：
  ```bash
  ./render.sh <work_dir>
  python3 <skill>/scripts/deliver.py --frames <work_dir>/frames --out clip.mp4
  ```
- 只渲几帧看效果（帧号从 0 起）：`ONLY=30,120,200,239 JOBS=4 python3 scene.py <帧目录>`。

## 已知限制
- QA 没有标出跳变帧（jump_frames 为空），最长静止段 0 帧；画面的变化来自笔尖推进和镜头移动，没有硬切。
- 开头 0.2 s 只有图框和地面线刚起笔，画面比较空，这是逐笔画的起点。
- 全图拉远后老鼠在 1080×608 小屏上只有约 50 px 宽，所以加了 DETAIL B 放大圆来保证认得出是老鼠。
- 老鼠的引线会穿过陶罐和地面斜线，这在工程图里是常见画法，但画面略密。
- 图纸上的小标注（尺寸、图框小格）大写高约 21 px，在 1080×608 下约 12 px，能读但不算大；主图题大写高 44 px。

## 模型声明
源码由 Claude Opus 5.5 编写并渲染。
