# retro-paper-collage · Retro Paper Collage

Ransom-note letters slap onto kraft paper asking why cats moved in with us, then paper-cut mice run to a grain heap and a tabby wildcat walks in. Every element is a torn-edge paper cut-out with its own drop shadow, animated at 12 fps with a three-frame edge boil, textured with tiled newsprint, halftone and tape patterns. Stack: Python, numpy, OpenCV, Pillow, multiprocessing.

```bash
./render.sh <work_dir>
python3 <skill>/scripts/deliver.py --frames <work_dir>/frames --out clip.mp4
```

Needs Python 3.9+, numpy, opencv-python, Pillow, ffmpeg, and these macOS system fonts: Impact, Arial Black, Georgia, Rockwell, Futura, Didot, American Typewriter, Courier New, Bodoni 72, Copperplate, Times New Roman.

---

# S05 复古纸张拼贴 — B「Why did cats move in with us?」（英文讲解版）

## 为什么重做
S05 定为 29 画风全片的开场。原来的 B 是第三方日文讲解片（猫怎么住进人类村子），需求是开场组的 B 换成英文讲解。原片没有英文版，这一支用同一题材重新做，构图、角色和素材全部自绘，没有用原片的画面。

## 节拍
0–2.4 s 牛皮纸桌面上，勒索信字逐个拍上来：WHY DID CATS / MOVE IN WITH US?，一只纸老鼠从底部窜过｜2.4–2.75 s 标题纸整张往左抽走｜2.55 s 左上角拍上 10,000 YEARS AGO｜2.9–4.1 s 四只老鼠依次跑向陶罐前的谷堆，字幕 STORED GRAIN DREW MICE｜4.6–6.1 s 虎斑野猫从右侧走进，5.2 s 字幕换成 ...AND MICE DREW WILDCATS｜6.0 s 老鼠四散｜6.2 s 猫抬头｜6.4 s 贴上 WILDCAT 黑标签和红箭头，6.75 s 补一条 Felis lybica 学名，停到 8 s。

## 画风对应（上游参考包 S05 配方：mg-styles-15 06-collage）
- 每个元素是一张剪纸：形状遮罩模糊后加噪声阈值，得到撕纸毛边；主体外面再撕一圈白纸边；底下一层软投影。
- 纸材是 512 平铺的周期纹理：牛皮纸、带小字的旧报纸、蓝天和太阳的半调网点、稻草斜纹、陶土网点、方格纸、蓝白条纹胶带。
- 勒索信字：每个字母单独一块纸片，十种字体、九种底色、各自 ±7° 的角度，按拍砸上来，第一拍放大 1.14。
- 元素动作按 12 fps 走，撕边每拍换一张，三张循环（定格的 boil）；镜头每拍手持微抖，8 秒推近约 1%；整体加左上偏亮的翻拍光和每拍纸面噪点。

## 复现
- 依赖：Python 3.9+、numpy、opencv-python、Pillow；ffmpeg；macOS 系统字体（Impact、Arial Black、Georgia、Rockwell、Futura、Didot、American Typewriter、Courier New、Bodoni 72、Copperplate、Times New Roman）。
- 渲染（8 进程约 25 s）：
  ```bash
  ./render.sh <work_dir>
  python3 <skill>/scripts/deliver.py --frames <work_dir>/frames --out clip.mp4
  ```
- 只渲几帧看效果：`ONLY=30,120,200 JOBS=3 python3 scene.py <帧目录>`。

## 已知限制
- 猫和老鼠是剪纸拼件，腿是简单摆动，没有原片角色那样细的表情。
- QA 标出的 73、75、78、155 帧跳变分别是标题纸抽走和字幕换句，属于设计。
- 12 fps 定格会让每拍内帧差接近 0，这是画风要求。

## 模型声明
源码由 Claude Opus 5.5 编写并渲染。
