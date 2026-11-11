# woodcut · Black-and-white Woodcut

A fishing boat with a patched sail after the storm, in pure black ink and paper white: the sail rises, the rope tightens, the clouds part with carved rays and the bow turns toward the light. Every sky, wave, cloud, sail and plank is built from individual gouge marks that follow the form, with uneven ink, wood-grain banding and paper texture re-printed every two frames. Stack: Python, numpy, OpenCV, Pillow, multiprocessing.

```bash
./render.sh <work_dir>
python3 <skill>/scripts/deliver.py --frames <work_dir>/frames --out clip.mp4
```

Needs Python 3.9+, numpy, opencv-python, Pillow, ffmpeg, and the macOS system fonts Baskerville and Songti SC.

---

# S30 黑白木刻版画 — B「风暴后修复渔船」

## 内容
风暴后的海面上，一条补过帆的渔船：收拢的破帆沿桅升起（补丁与针脚可见），主缆从松弛到收紧并回弹、绳结收紧；船身随浪轻摇，太阳前的云层用刀痕分开，放射状的"刻出来的光"逐渐伸长；最后船头转向有光的海面。与 A（铸钟）情节不同。

## 节拍
0–1 s 船、桅、海面黑白关系建立｜1.0–3.5 s 帆升起（12fps 姿态更新，顶端回弹）｜2.5–3.5 s 主缆收紧 + 绳结收紧回弹｜3.6–6.6 s 船摇幅加大，云分开，光芒伸长｜5.85–7.7 s 船头转向，镜头随之微移｜全程浪、云、纸墨微动。字幕 0.6 s 起印在纸边：After the storm, the sail goes up again. / 风暴过后，帆重新升起。

## 画风对应（依 L22 Woodcut Print 语法）
- 黑是木、白是刀刻掉的部分：天空、海、云、帆、船板全部由独立刀痕组成（钝入口、尖出口，刀与刀间留木）。
- 刀痕方向跟形体：海面沿浪形，云沿等值轮廓（只刻受光一侧），帆沿布纹，船板沿船形；宽度随明度（亮处几乎连成白）。远细密、近粗疏。
- 主体黑块 + 白色刀晕分离；帆为亮面，外沿留黑保持线。
- 印刷：纸边固定不动，版边毛糙；墨色 ±6% 不均 + 木纹条带 + 没吃墨的小白点 + 刀口毛刺；纸墨纹理每 2 帧轻微重印（纸墨微动）。
- 船、帆、绳按 twos（12fps）更新；浪、光、镜头按 ones。只用黑墨与纸白，无彩色版。

## 工具链与复现
- 依赖：Python 3.9+、numpy、opencv-python、Pillow；ffmpeg。
- 渲染：
  ```bash
  ./render.sh <work_dir>
  python3 <skill>/scripts/deliver.py --frames <work_dir>/frames --out clip.mp4
  ```
- 单帧预览：`python3 scene.py /tmp/keys 15,120,225`（帧号从 0 起）。每帧是 t 的纯函数，随机数全部固定种子。

## 素材来源与许可
- 画面全部由 `scene.py` 程序化生成，无外部图片。
- 字体：macOS 系统字体 Baskerville、Songti SC，仅渲染使用，未再分发；换机缺字体时会回退。
- 风格参考：lemo-opuscar `styles/woodcut/STYLE.md`（MIT，见 https://github.com/lemomo-ai/lemo-opuscar）。未使用其引擎代码或演示视频画面。

## 模型声明
本片由 Claude Opus 5.5 编写源码并渲染。上游提示语中的模型声明属于原作。

## 已知限制
- 风格语法对齐 A，但 A 有人物与近景手部雕塑，B 为风景+船，画面信息密度略低于 A 的人物场景。
- 风暴云团偏小，左上天空大块留黑。
- 船只转向是 3D 船体投影的偏航，转向中途帆接近侧对镜头，约 0.3 s 帆面较窄。
