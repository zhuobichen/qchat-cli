# brick-toy · Brick Toy

A tabletop brick world: a yellow-orange brick robot picks three 4x4 bricks from a pile and snaps them into a gap in a bridge, then a red brick car drives across and the bridge flexes under it. The look is a Blender EEVEE scene built entirely in code (real-scale studs, clearcoat plastic, jittered depth of field, characters stepped on twos at 12 fps) with a Pillow caption pass on top. Stack: Blender 5.2, Python, Pillow.

```bash
./render.sh <work_dir>
python3 <skill>/scripts/deliver.py --frames <work_dir>/frames --out clip.mp4
```

Needs Blender 5.2 on PATH, Python 3.9+, Pillow, ffmpeg, and the macOS system font Arial Rounded Bold.

---

# S33 积木玩具 · B「机器人搭桥」

## 内容
桌面积木世界：绿色底板上一座灰白积木桥中间缺三段，只剩三根桥墩露着凸点；红色积木小车在左岸等待。原创黄橙色积木机器人（蓝色面罩 + 两点眼睛）从右侧料堆依次取三块 4×4 积木（蓝、红、蓝），转身、抬起、对准、按下卡入桥墩凸点，每块落位有微小回弹。桥合拢后小车驶过（轮子转动），压过新桥段时桥块有小幅回弹；机器人转头目送并挥手。字幕胶囊：「Click. Click. Done.」。
与 A（白色宇航员机器人拼火箭）内容不同；机器人配色、造型、情节均为新做。

| 时间 | 动作 |
|---|---|
| 0–0.8 s | 缺段的桥、三根桥墩、等待的小车、料堆与机器人完整可见 |
| 0.8–4.05 s | 三次「取—转身—越过—对准—按入—回弹」，每次 1.2 s |
| 4.05–4.7 s | 机器人后退让开，转头看小车 |
| 4.3–7.5 s | 小车驶上新桥并通过，桥块被压后回弹 |
| 5.5–8 s | 机器人举手挥动、收势；字幕 4.2 s 起按 12 fps 弹入 |

## 画风对齐 A / 上游 L47 的做法
- 真实尺度：1 凸点 = 8 mm，砖高 1.2、板高 0.4；50 mm 镜头 f/8 物理景深（f/4 时近景桥面虚化过强会在 EEVEE 中出现前景半透明，故收小），低机位接近玩具视线，后景杯子/书本虚化（不用 A 的茶壶）。
- 塑料：clearcoat 0.8 / coat roughness 0.07，粗糙度通道叠加指纹/划痕噪声，倒角 0.045 凸点让边缘吃高光；凸点无字；底板为低光泽绿。
- 灯光：暖白主光（太阳）+ 前方柔光箱 + 冷色轮廓 + 顶光，环境 0.32。
- 动作语法：角色与积木按 12 fps 步进（on twos），相机、对焦、小车按 30 fps 连续；积木走弧线、卡入时小回弹；不变形（刚体）。机器人手臂姿态由所搬积木的位置反解，手始终扣在积木后缘。
- 字幕：深色胶囊 + 小积木图标 + 白字（Arial Rounded Bold，系统字体），按 12 fps 弹入，位于下方安全区内。

## 工具链与复现
- Blender 5.2.2 LTS（EEVEE，32 TAA samples，jittered DOF，关闭屏幕空间光追），Python3 + Pillow（字幕叠加），FFmpeg 8.1.1
- 渲染（`render.sh` 内部先用 Blender 渲出原始帧，再由 `caption.py` 叠字幕，最终帧写到 `<work_dir>/frames`）：
  ```bash
  ./render.sh <work_dir>
  python3 <skill>/scripts/deliver.py --frames <work_dir>/frames --out clip.mp4
  ```
- 全部几何、材质、灯光、动画由 `scene.py` 程序生成，确定性；无外部模型或贴图。
- 渲染要点：EEVEE 屏幕空间光追会让高光泽积木正面出现身后机器人的"透视鬼影"，后处理景深会让近景桥面边缘半透明；因此关闭光追（反射走环境探针），景深改为逐采样抖动（jittered），光圈 f/8。

## 素材来源与许可
- 无第三方 3D/贴图素材。字体为 macOS 系统自带 Arial Rounded Bold（仅本机渲染使用，未随包分发）。
- 风格参考：[lemo-opuscar brick-toy](https://github.com/lemomo-ai/lemo-opuscar/tree/main/styles/brick-toy)（lemo-opuscar，MIT），A 参考片（上游演示视频 CC BY 4.0，仅作分析，不复用画面）。
- 未使用任何品牌名称、Logo 或现成人仔/IP 造型。

## 模型声明
本片由 Claude Opus 5.5 在这次会话中编写脚本并实际渲染。上游演示片的模型声明与本片无关。

## 已知限制
- 未按 L47 建议做 2× 超采样（为控制渲染时长，用 32 TAA 采样代替）；细凸点边缘在缩小观看时可能有轻微闪烁。
- 机器人放砖时手部与积木为位置约束，未做手指抓握细节；小车压桥的回弹幅度很小（约 0.5 mm）。
- 字幕字体为 Arial Rounded，而非上游建议的 Fredoka（本机未安装）。
