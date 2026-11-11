# claymation · Claymation Stop-motion

A blue-grey clay cat on a yellow seamless backdrop presses a lump of clay into a flowerpot and plants a green sprout in it. It is a Blender EEVEE scene with procedural clay materials, metaball characters and real geometry thumbprints; all animation is sampled at 12 fps (on twos) while the camera moves continuously. Stack: Blender 5.2, Python.

```bash
./render.sh <work_dir>
python3 <skill>/scripts/deliver.py --frames <work_dir>/frames --out clip.mp4
```

Needs Blender 5.2 on PATH, Python 3.9+, ffmpeg. No external fonts, textures or assets.

---

# S12 黏土定格 · B「小猫捏盆栽」

## 内容
原创黏土小猫（蓝灰身、奶白爪口、粉鼻粉耳）在黄色无缝背景台上，把一团陶土色泥巴先压成饼，再挤拉成柱，用爪子按开顶口成花盆，把绿色小芽插进去，后退半步，叶片轻抖、耳朵抽动、眨眼、回头看镜头。与 A（西装男子音乐 MV）内容完全不同，不含 A 的人物、配角或歌曲。

| 时间 | 动作 |
|---|---|
| 0–1 s | 猫、泥团、桌面、黄色背景完整可辨；尾巴轻摆、眨眼，双爪抬起预备 |
| 1–2 s | 两次下压：泥团压成饼（中间有一次抬爪） |
| 2–3.1 s | 双爪移到两侧挤拉，泥饼变高柱 |
| 3.1–3.9 s | 左爪扶侧，右爪按入顶部，泥柱开口成带唇口的花盆 |
| 4.2–5.3 s | 身体侧倾，右爪拾起小芽，越过盆口放入 |
| 5.3–6 s | 斜后退半步（小跳） |
| 6–8 s | 叶片衰减回弹 + 微风摆动，双耳先后抽动，眨眼，歪头，转头看镜头 |

## 画风对齐 A 的做法
- 材质：全部为程序化黏土材质——哑光（roughness≈0.62）、少量次表面、细颗粒噪声凹凸、平滑 Voronoi 拇指压痕、局部斑块化的指纹环纹；泥团/花盆网格另有真实几何压痕（7 个拇指坑）与手工不对称（半径正弦扰动 + Perlin 噪声），形变时压痕跟着泥料走。
- 体积：泥团→泥饼→泥柱→花盆四个关键截面的体积按估算保持在 25–30 cm³ 区间（球 28.7 / 饼 ≈25 / 柱 ≈29.7 / 盆壁 ≈26.5）。
- 场景：真实微缩尺度（厘米建模），40 mm 镜头 f/11 物理景深，黄色无缝背景（色值按 A 实际像素校准，A ≈ RGB 218,190,40；B 背景实测 213–238,179–201,32–62），柔光大面光 + 补光 + 轮廓光。
- 定格节奏：角色、泥料、芽、叶全部按 12 fps 取样（30 fps 输出中 2/3 帧交替保持）；每个 pose 有微小位置抖动与灯光 ±2% 闪烁；相机按 30 fps 连续缓推（不步进，避免抖动）。无长冻结（见 QA）。

## 工具链与复现
- Blender 5.2.2 LTS（EEVEE，光追开启，32 TAA samples），系统 FFmpeg 8.1.1
- 渲染：
  ```bash
  ./render.sh <work_dir>
  python3 <skill>/scripts/deliver.py --frames <work_dir>/frames --out clip.mp4
  ```
- 预览单帧：`blender -b --factory-startup -P scene.py -- /tmp/x 120 120 1 50`
- 渲染要点：景深用 EEVEE jittered DOF（逐采样抖动，后处理 DOF 会在轮廓留下亮黄光晕）；Blender 的 metaball 网格分辨率下限约 5 mm，脚本按 10 倍尺寸建模再把物体缩小 10 倍，得到约 0.5 mm 的等效网格（否则爪子/身体会出现多边形棱面），黏土材质的纹理坐标同步缩放。
- 全部几何（metaball 角色、旋转体泥料、道具）、材质、灯光、动画均由 `scene.py` 程序生成，确定性（固定随机种子），无外部资产、无纹理贴图、无字体。

## 素材来源与许可
- 无第三方素材。所有内容为这次原创程序化生成。
- 参考：[Prompt Motion 上 davidshulmanfl 的参考片](https://prompt-motion.com/davidshulmanfl-371638)（，仅作材质/节奏观察，不复用画面；其公开可播放不等于商业复用授权）。上游提示语见[Prompt Motion 上 davidshulmanfl 的作者说明](https://prompt-motion.com/davidshulmanfl-371638)（中文转述）。

## 模型声明
本片由 Claude Opus 5.5 在这次会话中编写 Blender 脚本并实际渲染。A 参考片的上游生成模型声明属于原作者，与本片无关。

## 已知限制
- 角色是 metaball 圆润造型，黏土"手捏感"主要来自凹凸贴图与几何压痕；与 A（疑似视频生成模型的照片级黏土）相比，细节密度和光照真实感略低，属于"实拍黏土动画"范式内的程序化重建。
- 背景道具（蓝色浇水壶、红蘑菇）为简化造型；浇水壶轮廓偏抽象。
- 爪子与泥料的接触为位置跟随，没有物理接触形变（手指不会陷入泥料表面）。
