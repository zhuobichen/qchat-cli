# glassmorphism-ui · Glassmorphism UI

Frosted-glass cards fan out over warm drifting light blobs, a Liquid-Glass lens ticks off three checkboxes, and the main card folds into a Focus card. It uses real CSS backdrop-filter blur plus an SVG feDisplacementMap lens with RGB dispersion; every frame is a pure function of t, captured one by one in headless Chrome. Stack: Node, puppeteer-core, HTML/CSS/SVG.

```bash
./render.sh <work_dir>
python3 <skill>/scripts/deliver.py --frames <work_dir>/frames --out clip.mp4
```

Needs Node 20+, puppeteer-core 24.10.0 (render.sh runs `npm ci` on first use), Chrome for Testing 155 or any Chrome via `CHROME_PATH`, ffmpeg, and the macOS system fonts SF Pro and PingFang SC.

---

# S06 玻璃拟态UI — B「Just three things / 今天只做三件事」

## 内容
磨砂玻璃卡片先叠成一束，主卡滑出到前景并浅推近；一枚 Liquid-Glass 透镜依次落在三个复选框上完成勾选（卡片轻微弹性响应、进度环 0/3→3/3），主卡收拢成 Focus 卡，边缘高光扫过，结尾大字 "Clear the rest. / 其余的，都放下"。与 A（Aurora 聊天/思考）内容不同。

## 节拍
0–1 s 卡束入场（opacity + 小位移，帧0即有画面）｜1–3 s 卡束展开、主卡前移、行项逐条浮现、整体浅推近｜3.35 / 4.25 / 5.15 s 三次勾选｜5.4 s 主卡边缘高光扫过｜5.9–7.0 s 主卡收拢为 Focus 卡｜7–8 s 文案浮现，卡片呼吸微动。

## 画风对应
- 背景：5 个邻近色大光斑。2026-10-26 按卡尔审核意见改为 A 的互补色：A 的紫/蓝/青/洋红分别换成琥珀/橙/珊瑚红/青柠，底色从深蓝改为深暖棕红；复选框、透镜、进度环、Focus 球、高光扫过一并改为暖色。这一改动偏离了任务提示语中同画风 A/B 保持主色体系一致的要求，由用户明确决定。改前的蓝紫版源码存档在 `index_A色版.html`。原句：5 个邻近色（紫/蓝/青/洋红）大光斑沿贝塞尔路径漂移 + 光点 + 暗角 + 逐帧颗粒（防 banding）。
- 玻璃：真实 `backdrop-filter: blur(34px) saturate(150%)`，白色 5–16% 渐变填充，1.5px 内高光描边，大圆角，投影。
- 透镜：SVG `feDisplacementMap` 球冠位移图做真折射，R/G/B 三通道不同位移量形成色散边缘，作为 `backdrop-filter: url(#lensFilter)`。
- 缓动：sine / cubic / 阻尼弹簧；无 CSS transition/animation，每帧是 t 的纯函数。

## 工具链与复现
- 依赖：Node ≥ 20、`npm ci`（puppeteer-core 24.10.0）、Chrome for Testing 155（puppeteer 缓存路径，或 `CHROME_PATH` 指定）、ffmpeg。
- 渲染（`render.sh` 在没有 `node_modules` 时会自动 `npm ci`）：
  ```bash
  ./render.sh <work_dir>
  python3 <skill>/scripts/deliver.py --frames <work_dir>/frames --out clip.mp4
  ```
- 单帧预览：`node render.cjs /tmp/keys 15,120,225`

## 素材来源与许可
- 全部为本目录程序化生成：无外部图片/视频/字体文件。
- 字体：系统字体 SF Pro / PingFang SC（macOS 自带，仅渲染使用，未再分发）。换机渲染时字体回退可能导致字形差异。
- 风格参考：MG Styles 15「12-aurora-glass」提示语（MIT，见 https://github.com/Vincentwei1021/mg-styles-15）。未复用其源码或视频画面。

## 模型声明
本片由 Claude Opus 5.5 编写源码并渲染。上游提示语中的模型/评分声明属于原作，不代表本片。

## 已知限制
- 无音轨（按规格静音）。
- 透镜内部偏暗（位移采样到深色背景），读作玻璃泡而非放大镜；色散边缘清楚。
- 0–1.5 s 主卡内容逐步浮现，开头主卡下半部较空。

> 注：2026-10-27 发现本机 puppeteer 缓存的 Chrome for Testing 已被清掉。复现时请重新执行 `npx @puppeteer/browsers install chrome@155.0.8059.79`，或者用 `CHROME_PATH=` 指向一个 Chrome。系统 Chrome 只验证过能打开审核页，没有用它重渲染过成片。
