# risograph · Risograph Print

A cyclist rides through a park under MAKE IT / MOVE IT title slams, printed as three misregistered ink plates (yellow, fluorescent pink, blue). Each plate is its own halftone screen at 0, 75 and 15 degrees, multiplied like ink on paper, with per-plate offsets and paper fibre and pinholes refreshed on twos. Stack: Python, numpy, OpenCV, Pillow, multiprocessing.

```bash
./render.sh <work_dir>
python3 <skill>/scripts/deliver.py --frames <work_dir>/frames --out clip.mp4
```

Needs Python 3.9+, numpy, opencv-python, Pillow, ffmpeg, and the macOS system font Helvetica Neue.

## Keep / replace (when you change the subject)

Keep, these make the look: `ANG` and `SCREEN` (screen angles 0/75/15 and the halftone screens), `class Plate`, the per-plate offset and `osc()` wobble, the ink multiply and the grain / pinhole pass at the end of `frame()`, and the 12 fps element clock with the 30 fps camera.

Replace, this is the subject: everything drawn inside `frame()` between the plate setup and the composite (park, trees, cyclist, petals), the title words and their timing.

- Plates are combined with max, so a shape on one plate does not hide another plate. To punch a window or a face out of a solid area, draw it with `v=0` on the other plates first (`Plate.rect / ellipse / poly / text` with `v=0` is the knock-out tool).
- `word()` slams one letter at a time; the title hit and echo loops assume 7 letters (`range(7)`), so change that count when your words differ.
- Single-frame preview: `ONLY=60,150 python3 scene.py <dir>` renders just those frames.

---

# S11 Risograph 孔版套印 — B「MAKE IT MOVE IT」公园骑行

## 为什么补做
上游参考包里 S11 的 B 只有一张海报，没有视频地址，之前的色序和排版都用静帧占位。需求是补上，这一支按 A 的配色和 lemo risograph 配方新做。

## 节拍
0.15 s 起 MAKE IT 逐字砸下（蓝实地，粉版回声带套印错位，0.5 s 后淡出）｜0.9 s 起九棵粉色树依次弹出｜1.8–7.6 s 骑车人从左到右穿过公园，轮辐和踏板跟着转，黄围巾飘｜3.35 s 起 MOVE IT 逐字砸下（粉实地，蓝版回声）｜5.6 s 底栏出现 MAKE IT MOVE｜6.5 s 三块版整体错开一次再回正｜全程花瓣飘落，镜头推近 3%。

## 画风对应
- 三块印版分开画：黄、荧光粉、蓝，每块是 0–1 的网调图；半调网点网角分别 0°、75°、15°，满版处是实地。
- 合成按油墨正片叠底：黄压蓝出绿，粉压蓝出紫，粉压黄出橙，和 A 的配色同源。
- 套印错位：每块版各自偏移，字砸下时粉版做衰减震荡，6.5 s 全版错开再回正。
- 元素按 12 fps 走，镜头推近按 30 fps 连续；纸纤维、墨量不匀、针孔按拍刷新。

## 复现
- 依赖：Python 3.9+、numpy、opencv-python、Pillow；ffmpeg；Helvetica Neue（系统字体）。
- 渲染：
  ```bash
  ./render.sh <work_dir>
  python3 <skill>/scripts/deliver.py --frames <work_dir>/frames --out clip.mp4
  ```

## 已知限制
- QA 标出的 195 帧跳变是 6.5 s 的整版错位，属于设计。
- 骑车人是几何拼件，没有 A 那样的街景建筑。

## 模型声明
源码由 Claude Opus 5.5 编写并渲染。
