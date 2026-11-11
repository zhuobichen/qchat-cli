# chinese-ink-wash · Chinese Ink Wash

A quiet village hearth in ink wash: a villager lowers a broom, a tabby cat curls up by the stove, the villager fades out like washed ink, a moon is baked into the paper and one red seal stamps down, with short vertical English subtitles. The look comes from a brush engine (variable-width strokes, per-bristle ink load and dry-brush breakup), five ink tones composited by transmission, and a long-fibre rice-paper texture. Stack: Python, numpy, OpenCV, Pillow, multiprocessing.

```bash
./render.sh <work_dir>
python3 <skill>/scripts/deliver.py --frames <work_dir>/frames --out clip.mp4
```

Needs Python 3.9+, numpy, opencv-python, Pillow, ffmpeg, and the macOS system font Baskerville.

---

# S03 中国水墨 — B「PEOPLE DID NOT CHASE IT AWAY / THE CAT STAYED」（英文讲解版，节拍 4）

## 为什么重做
原来的 B 是第三方日文讲解片（水墨画的村落和猫，竖排日文字幕）。需求是换成英文讲解，这一支只讲整个故事的第 4 拍：村民没有赶走野猫，猫就留了下来。原片只拿来看画风，构图、角色和素材全部自绘，没有照搬原片的画面和排布。

## 节拍
0–0.7 s 宣纸上清墨远山从两侧洇开，中间留白｜0.2–1.0 s 屋檐侧锋一刷、门楣和两根门柱、门洞一层清墨｜0.4–1.6 s 右上角竖排短行逐行写出 PEOPLE / DID NOT / CHASE IT / AWAY｜0.55–1.2 s 拿着扬起扫帚的村民逐笔画出｜0.75–1.5 s 陶罐没骨画出，灶石和柴｜1.0 s 灶火起，灶烟开始往上飘｜1.0–1.7 s 坐着的虎斑猫逐笔画出，罐边几片兰叶草｜1.9–2.9 s 村民把扫帚放到地上，左手向猫伸出，猫转头看他｜2.7–3.7 s 猫在灶边蜷成一团、闭眼｜3.9–4.4 s 字幕墨晕化开，4.35 s 起写出 THE CAT / STAYED｜4.4–5.6 s 村民像墨被水洗淡一样隐去｜4.7–5.7 s 清墨从外往里烘出一轮月亮，5.2 s 淡墨一笔不闭合的圆｜6.2 s 朱红印章按下｜6.3–8 s 猫随呼吸起伏，火苗和灶烟在动，镜头朝猫推近 6%。

## 画风对应（上游参考包 S03 配方：五档墨色、留白过半、带墨量的毛笔笔触、只盖一枚朱红印章）
- 笔触引擎和 S19 同源：变宽墨带加刷毛轨迹，每根刷毛有自己的墨量和枯竭点，笔尾刷毛先后断掉，出飞白。门柱、陶罐、人、猫都是几笔拼出来的，没有闭合描边。
- 墨分五色：焦 1.8、浓 1.0、重 0.62、淡 0.32、清 0.13（浓度倍数），按透射叠加，墨叠墨更深。
- 宣纸：暖白底、两千多根长纤维、低频云斑；湿笔顺着纤维洇开，淡墨边缘积墨；远山山脚化进雾里。
- 留白：画面上半部和中间大片空着，主体压在下方一条地平线上。
- 烘云托月：月亮本身是纸白，外圈清墨烘进来。
- 唯一的红色是右上角的朱红印章，白文猫爪印，按下时略大再落定，印泥不匀、边缘毛。印章里没有文字。
- 字幕用 Baskerville SemiBold，大写、加字距，右上角竖排短行，右对齐，逐行写出；字幕和印章不跟镜头推，保证在安全区内。

## 复现
- 依赖：Python 3.9+、numpy、opencv-python、Pillow；ffmpeg；macOS 系统字体 Baskerville。
- 渲染（8 进程约 10 s）：
  ```bash
  ./render.sh <work_dir>
  python3 <skill>/scripts/deliver.py --frames <work_dir>/frames --out clip.mp4
  ```
- 只渲几帧看效果：`ONLY=36,66,99,195 JOBS=4 python3 scene.py <帧目录>`（帧号从 0 起，文件名从 0001 起）。

## 已知限制
- QA 没有标出跳变帧（jump_frames 为空）；全片没有切镜，字幕换句用墨晕化开，村民淡出、月亮烘出都是渐变，最大帧差 0.73（第 14–15 帧，开场门和远山正在落笔）。
- 第 1–2 帧几乎静止（帧差小于 0.02）：开场空白宣纸，远山刚起笔，只有 2 帧，不影响判定。
- 平均帧差 0.27，明显低于 A 的 2.29；水墨画面大面积留白，动的只有人、猫、火、烟和镜头，属于画风取舍。
- 村民和猫是几笔写意拼件，猫从坐到蜷是同一组笔触的形变，没有逐帧手绘那样的细节。
- 门洞里那一层清墨带竖向刷痕，远看有点像竹帘。

## 模型声明
源码由 Claude Opus 5.5 编写并渲染。
