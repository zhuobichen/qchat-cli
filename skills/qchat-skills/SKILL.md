---
name: qchat-skills
description: 朝闻（QQ 机器人）这个号**这个项目本身**能干什么：群聊收发、梗库、表情包、历史索引、开黑战报、日记、好友管理、NapCat 运维。这是基础设施层的地图，用来回答"这个库自带什么、命令怎么调、踩过哪些坑"。**外部装进来的能力不在这里**（见 skills/README.md 的清单）。当需要知道本仓库有哪些脚本/命令、某个能力是不是自带的、或忘了怎么调时读这个。
---

# qchat-skills（本仓库自带的能力地图）

项目根：`D:\github_project\ZhaoWen_GitHub维护\qchat-cli`
账号：朝闻 2396130865 ／ 号主：1473517806 ／ 主群：913807639

**这个文件只记"仓库自带的"东西。** 会话、读写文件、跑命令、搜索这些是环境天生的能力，不往这里写。
外部引入的能力（carl-motion 之类的）单独登记在 `skills/README.md`。

**行文约定：** 每条给"什么时候用 + 命令 + 一个踩过的坑"，细节去对应文件。

---

## 1. 群聊：说话

```bash
node dist/cli.js send group <群号> "内容" --force
node dist/cli.js send msg   <QQ号> "内容" --force
```

- 发图/视频必须用**绝对路径**，相对路径 NapCat 会报「识别URL失败」。
- 发 CQ 码 `@`：`[CQ:at,qq=xxx]`。
- 群里消息不要超过两句；这是人格文档的硬要求。

**坑**：待回复队列会重复投递同一条消息（观察到消息文本相同的推送重复出现）。收到明显重复的旧消息，直接跳过，别回第二遍。

## 2. 群聊：收消息

```bash
node scripts/qq-health.mjs                 # 0 正常 / 1 半死 / 2 挂
tail -3 output/qq-watch.log                # 监视器每轮在跑
```

- **在线判据只看 `get_friend_list`**，`get_status.online` 会滞后骗人。
- 翻历史：`getGroupMsgHistory(gid, seq, count, reverseOrder=true)` —— **`reverseOrder` 必须传**，否则 NapCat 无视 `message_seq` 重复返回最新页（这就是"只能拿 100 条"的假象）。
- 翻页锚点取"本页**新增**消息里最早的 seq"，终止条件是"连续两页无新消息"。
- 引用消息：`reply` 段只有 `message_id`，正文要再 `get_msg`。

## 3. 全量历史索引

```bash
node dist/cli.js index <群号> --limit 2000
node dist/cli.js index <群号> --stats
```

实测本群 711 条 / 最早 2026-11-06（服务端保留的尽头）。

## 4. 梗库

```bash
node scripts/meme-upsert.mjs <file.json>      # 按 term 去重更新
node scripts/wiki-build.mjs --with-terms      # 生成 wiki（不加参数只出目录）
node scripts/refresh-knowledge.sh --crawl
```

- 词库：`private/knowledge/terms.jsonl`（约 4600 条），成页后在 `private/wiki/`（4576 条）
- 查梗：`node scripts/meme-lookup.mjs <词>`（标题命中优先，其次正文；`--sticker` 查图，`--all` 两头查）
- **`wiki-build` 不加 `--with-terms` 不生成词条页**——加了参数才算真进 wiki。
- 采集源：`gengbaike.cn` 的站点 TLS 坏了，必须 `curl -sk`。

## 5. 表情包

```bash
node scripts/send-sticker.mjs <意图>     # 笑 / 无语 / 看戏 / 吃 / 行 …
node scripts/meme-lookup.mjs 无语 --sticker   # 先看候选 label 再决定发哪张
```

963 张，`private/emoji-library/manifest.json` 里按 label 检索（现在是 172 张还是「待标」）。
**坑**：库里的文件名后缀经常和真实格式不符（GIF/WEBP 写成 .png），按扩展名判断类型会错。

## 6. 生图 / 生视频（豆包桌面版）

```bash
node scripts/gen-media.mjs --image "提示词" [--ref 参考图] [--send]
node scripts/gen-media.mjs --video "提示词" [--ref 参考图] [--send]
```

六个坑，全踩过：

1. **必须操作主窗** `doubao-chat`（1190×756），不是 `doubao-launcher`（400×600 小侧窗）
2. **提示词里必须写「视频」「N 秒」**，否则豆包当生图处理
3. 文字用 `Input.insertText`，图片用 CDP 原生 `dispatchDragEvent`，**先文字后拖图**
4. 确认要发文字「开始生成」（豆包有三种说法：是否按以上参数／正在等你确认／开始生成）
5. 产物在 `<video>` 元素里，不是 `[class*="block-video"]`
6. 页面用久了 `input[type=file]` 会消失 → 走 paste/drop 兜底

耗时：生图 30 秒，生视频 6-16 分钟。**不要在这段时间里承诺时间。**

## 7. 动效画风（carl-motion，外部引入）

```bash
ls skills/carl-motion/references/styles/          # 29 种风格卡
python3 skills/carl-motion/scripts/doctor.py      # 环境检查（缺 ffmpeg 就补 PATH）
```

**跟豆包的根本区别**：这里是**代码渲染**，不是 AI 生成像素。可复现、可精细控制、参考图能改源码。
适合：要精确控制版式（9:16 竖屏、标题条、字幕位置）的切片。
不适合：写实人像、复杂动作。

**本项目已经补上的两个引擎（上游没有源码的）：**

| 脚本 | 风格 | 检查结果 |
|---|---|---|
| `.cm-test/engine/ink-whale.py` | 水墨 | YELLOW（第 32 帧是设计拍） |
| `skills/pixel-game/pixel-whale.py` | 像素游戏 | GREEN |

**像素引擎的规格（上游只有提示词，照它写的）**：内部 320×180 → 最近邻 6 倍、14 色、8fps 阶梯帧、坐标全取整、dithering 做过渡。
**踩过的坑**：水墨那条第一次跑出来有 75 帧零变化（画完就不动了），
被 `deliver.py` 判成 yellow。**静止段必须给一个一直在动的东西**——呼吸浮动、尾摆、烟、推镜，选一个。

## 8. 图片文字（我看不了图时的兜底）

```bash
python scripts/ocr.py <图片路径>
```

**当前模型不收图片输入**。遇到群里发图：先 `get_image` 拿本地文件 → OCR 提文字 → 只回文字能确认的部分，**画面内容不要猜**。

## 9. 语音 / 视频转文字

```bash
node dist/cli.js watch <视频URL或路径>              # 默认只要逐字稿
node dist/cli.js watch <路径> --frames 8            # 要截帧
```

**坑**：rap / 带 BGM / 多人合唱，ASR 基本不能用（「典孝急」被听成「顶骨、舍人、太区」）。
**这类内容直接搜公开歌词/文稿，别指望转写。**

## 10. 开黑战报

```bash
node scripts/hex-announce.mjs --loop     # 常驻
node scripts/hex-stats.mjs <名字>
```

配置：`private/hex-roster.json`（anchor 必须同局 + 至少 minOthers 人）
**默认只推给号主确认，不自动发群。**

## 11. 日记

```bash
node scripts/diary.mjs write "标题" "正文" --tags a,b
node scripts/diary.mjs list --limit 10
node scripts/diary.mjs md > 日记.md
```

落盘 `private/diary.jsonl`，QQ纪实面板读它。

## 12. 好友

```bash
curl "http://127.0.0.1:9876/add-friend?uin=<QQ号>&msg=<附言>"
node scripts/friend-watch.mjs --uin <号1>,<号2> --notify
```

- 走 NTQQ 内核 `reqToAddFriends`，`result: 170` = 请求已发。
- **NapCat 没有"好友申请列表"API**，只能轮询好友列表判断是否通过。
- 每个号一个状态文件 `output/friend-watch/<uin>.json`（共用一个会互相覆盖）。

## 13. NapCat 管理

```bash
node dist/cli.js napcat status      # :3000 是否在线
node dist/cli.js napcat start -q <uin>
```

- **`checkNapCat` 必须带 token**——配置设了 token 后不带 Authorization 一律 403，会导致「已在线却显示离线」「start 白等 180 秒」。
- `start` 是**阻塞等登录**的命令：已经 healthy 时**不要调用**。
- 二维码窗口：记 PID 到 `output/.qr-viewer.pid`，开新窗前先关旧的（默认看图器是 `360AlbumViewer64.exe`）。

## 14. 长驻进程的通用坑

**`host_exec` + `detach: true` 起的进程，stdout 会被丢弃（日志恒为 0 字节）。**
所以长驻脚本必须**自己 append 到日志文件**，否则你会以为它没在跑。

---

## 15. 派活（把写代码的活丢给独立会话）

```bash
node scripts/dispatch.mjs lanes                    # 三条车道谁在跑
node scripts/dispatch.mjs new "<任务>" --lane cli   # cli / software / data
node scripts/dispatch.mjs new "<任务>" --notify group:913807639   # 干完自动回报
node dist/cli.js dispatch lanes                    # 同一个东西的工具层入口
```

车道定义在 `private/lanes.json`；默认工作区 `D:\qq助手`。

**最关键的坑**：建会话必须用 `createSession { workspaceId }`，不能用 `start { cwd }`——
前者会 `attachSession` 进工作区（侧栏看得见），后者不会。详见 `private/rules.md` 第 11 节。

## 判断该不该用哪个

| 想干的事 | 用哪个 |
|---|---|
| 在群里说句话 | `qce send group` |
| 精确控制版式的短片 | carl-motion（代码渲染） |
| 写实/复杂动作的短片 | 豆包（AI 生成） |
| 群里发来的图是什么 | OCR，**拿不到画面就直说** |
| 视频/歌里的文字 | 能搜歌词就搜，ASR 最后考虑 |
| 查某人战绩 | `hex-stats.mjs` |
| 今天干了啥 | `diary.mjs` |
