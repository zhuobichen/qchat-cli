# huashu-portraits · Egyptian mural / Van Gogh / Monet

Three painter styles on one Node + canvas project, built on the huashu-art-motion painting library (`upstream/`, MIT). The lead character is a stylised Carl: black square glasses, curtain fringe, cream T-shirt.

```bash
./render.sh <work_dir> s22_egypt     # Ancient Egyptian Mural
./render.sh <work_dir> s23_wheat     # Van Gogh Impasto
./render.sh <work_dir> s24_bridge    # Impressionist Oil (Monet)
python3 <skill>/scripts/deliver.py --frames <work_dir>/frames --out clip.mp4
```

Needs Node 20+; the first run does `npm ci` (@napi-rs/canvas 0.1.65). Deterministic: every frame is a pure function of t with fixed seeds.

---

三种画家风格共用一套 Node + Canvas 工程，画法库来自 huashu-art-motion（`upstream/`，MIT）。主角是风格化的卡尔：黑色方框眼镜、中分帘式刘海、米白 T 恤。

## 内容与节拍

| 场景 | 内容 | 0–2 s | 2–5 s | 5–8 s |
|---|---|---|---|---|
| s22_egypt 古埃及 | 卡尔按埃及程式侧身迈步（侧脸配正面眼、正面双肩、侧身腿，方框眼镜按正面眼的程式画），圣甲虫推红日盘，河带展开 | 河带从左向右展开，铭文逐个写出，卡尔站定 | 卡尔侧步走过下栏，圣甲虫把日盘推到地平线山口 | 日盘落进山口、升起成阿顿，光线末端的小手张合，一只手把安卡递到卡尔面前，卡尔举起双手致敬 |
| s23_wheat 梵高 | 卡尔走过旋涡星空下的麦田，麦浪随风起伏，柏树像火焰 | 进画 | 走过麦田，麦浪分开 | 停步回头看 |
| s24_bridge 莫奈 | 卡尔走上睡莲池上的绿色拱桥，树影和碎光斑掠过衣服 | 上桥 | 过桥顶 | 停步，手扶栏杆，低头看水，涟漪变大 |

## 画风做法

- **古埃及**：字形库、四色彩块边框、壁画表面（斑驳 multiply、发丝裂纹、颗粒）、阿顿小手、圣甲虫画法和铭文写出的动画，直接取自 `upstream/02_egypt.js`（MIT），构图改成上下两栏加河带。
- **梵高、莫奈**：先平涂底稿，再加分区流场笔触与区域色板。角色先平涂，再用 source-atop 补细笔触，最后补五官。莫奈的笔触以 6 fps 重绘（boil）。

## 工具链

- 关键帧预览：`./keys.sh <场景> /tmp/keys.jpg`，输出 0.5/2/4/6/7.5 s 拼图；单帧用 `node render.cjs <场景> <目录> 15,120`。
- 文件：`env.cjs` 在 Node 里搭浏览器全局并加载上游库；`carl_rig.js` 是梵高、莫奈用的卡尔 3/4 侧绑定（走路循环、IK 手臂、刘海、眼镜、露齿笑）；`scenes/*.js` 是三个场景，古埃及的卡尔造型写在自己的场景文件里。

## 素材来源与许可

- `upstream/lib/*.js`、`upstream/02_egypt.js` 等来自 [huashu-art-motion](https://github.com/alchaincyf/huashu-art-motion)（MIT，见 `upstream/LICENSE_huashu`）。古埃及直接复用的部分在文件头注明；梵高、莫奈只用了库，场景代码为新写。
- 没有用外部图片、贴图或音频。
- 场景源码由 Claude Opus 5.5 编写并渲染。

## 已知限制

- 古埃及程式下卡尔穿白亚麻褶裙，只保留 T 恤、发型、眼镜和笑容。
- 莫奈里卡尔衣服的笔触密度比背景低；树影光斑做得很淡，以免读成脏污。
