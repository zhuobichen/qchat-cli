# Changelog

所有值得记录的变更。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [0.24.2] - 2026-11-07

### Docs

- **`QUESTION.md` 新增 Q12–Q23**：本轮踩过的坑全部记录，含排查过程与关键实验
  - Q12 cuDNN autotune 导致 TTS 一次 19 秒（**真因**，修完 0.43 秒）
  - Q13 venv 在中文路径下静默回落 CPU 版 torch
  - Q14 torchcodec 在中文路径下 DLL 加载失败 + soundfile 回退（含通道顺序坑）
  - Q15 语音条「语音转换失败」三连坑（wav 不认 / file:// 不认 / 需 AMR+base64）
  - Q16 同一 QQ 号只能一端在线
  - Q17 NapCat 静默失败 + 弹旧二维码（权限）
  - Q18 `get_login_info` 缺 token 导致一直「等待登录」
  - Q19 watcher 把历史消息当新消息（含自己犯的两个错）
  - Q20 「看起来在跑其实啥也没干」三个真实案例
  - Q21 Node 24 + undici 退出触发 uv assertion
  - Q22 cmd 批处理 UTF-8 中文导致跑错目录
  - Q23 pip 批量装依赖卡死（逐个装 3 分钟 vs 批量 21 分钟无进展）

## [0.24.1] - 2026-11-06

### Fixed

- **`napcat start` 一直显示「等待账号登录」**：轮询 OneBot 的 `get_login_info` 时**没带 Bearer token**，接口返回 401 → 解析成 null → 永远等不到（其实早就登上了）。新增 `readOnebotToken()`，启动前从 `config/onebot11_<uin>.json` 读 token 并带上
- **`napcat start` 低权限下 EPERM 崩溃**：`loadNapCat.js` 已存在且内容一致时不再重写（它是��次性启动垫片）；写不了时给出明确警告而不是崩溃
- **新增启动前权限自检**：目标目录不可写时直接提示「请用管理员权限运行 start-napcat-admin.cmd」，不再让用户对着旧二维码反复扫码
- **`start-napcat-admin.cmd` 编码**：原文件是 UTF-8，cmd 解析中文注释乱码导致 `cd` 失败、跑到了 `C:\Windows\System32` → 改为纯 ASCII + CRLF

### Verified

- 重启电脑后完整恢复：NapCat(3000) / api_v2(9880) / qq-watch / DSH(3080) 全部在线
- watcher 重启即抓到 3 条新消息并汇总投递

## [0.24.0] - 2026-11-06

### Added

- **待回复队列**（`scripts/qce-queue.mjs` + `qce queue`）
  - QQ 消息进来 → 入队落盘 → 会话里的我处理 → 出队
  - 队列落盘，进程崩了/断线了消息还在，重启接着处理
  - `take` 标记 processing；`reclaim` 把超时的 processing 重新入队
  - `qce queue list|take|done <id>|skip <id>|reclaim`
- **watcher 接入队列**：投递到会话的同时入队，带上下文与回复提示

### Changed

- **回复由会话内的「我」生成**，不再由独立进程另调模型：`qce-auto` 停用
  - 这样走的是本地 harness 环境——同一套模型、记忆、人格、工具
  - `qce-auto` 保留可用（独立进程自带模型配置），需要时再起

### Notes

- DSH supervisor 的 `POST /chat` 是单向投递（不返回助手回复），`tail` 只认 `source.kind==='user'` 的消息，所以「读回回复」不可行；
  改为「投递 + 入队」：我被唤醒后在会话里自己产出回复，再用 `qce send` 发出去

## [0.23.1] - 2026-11-06

### Fixed

- **`qce-auto` Windows 路径导入崩溃**：`import('D:/...')` 在 ESM loader 上必须用 `file://` URL（`pathToFileURL`），修前生成回复必失败进死信
- **`qce-auto` 循环被 ReferenceError 中断**：debug 分支引用了已改名的 `message.time`（应为 `meta.time`），异常被外层 catch 吞掉 → 每轮只处理第一条消息
- **`qce-auto` 媒介判断未 await**：`decideMedium` 是 async，未 await 导致日志显示 `undefined`

### Verified

- 真机：私聊「你是?」→ 2 秒内自动回复成功（模型 `qwen3.7-flash`）

## [0.23.0] - 2026-11-06

### Added

- **常驻自动回复进程 `scripts/qce-auto.mjs`**
  - 循环：轮询新消息 → 判断该不该回 → 生成回复 → 决定文字/语音 → 发送
  - **2 秒轮询**（好友/群列表缓存 60s，不重复拉）
  - 幂等：message id 去重，重复跑不重复回
  - **断点续传**：状态原子写入（.tmp→rename），关机再开机从上次位置继续
  - 可靠性：生成失败/发送失败重试 3 次；连续失败 5 次熔断 60s；彻底失败进 DLQ（`--dlq` 查看，`--replay <id>` 重放）
  - 语音：本地克隆音色（`ttsEndpoint`/`ttsRefAudio`/`ttsPromptText`）
  - 上下文注入：群 → 人格 + 成员画像；私聊 → 长期记忆
  - 配置 `private/auto-reply.config.json`：`allow` 白名单 / `groups` / `requireMentionInGroup` / `minReplyGapSec` / `maxAgeSec` / `allowVoice`
  - 命令：`--once` 单轮、`--status` 状态、`--dlq` 死信、`--replay <id>` 重放

### Fixed

- `qce-auto` 好友列表取 `user_id`（NapCat 的 `get_friend_list` 返回 `user_id/nickname`，不是 `peerUin`）——修前一条消息都收不到
- `qce-auto` 排除自己的会话（避免 `get_friend_msg_history` 报「消息不存在」）
- Node 24 + undici 在 Windows 上 `process.exit()` 触发 uv assertion → 改为自然退出（`process.exitCode` + 2s 兜底强退）

## [0.22.0] - 2026-11-06

### Added

- **该发文字还是语音**（`src/core/reply-medium.ts` + `qce reply`）
  - 硬规则优先：对方发语音→回语音；说「唱个歌/听听你的声音/说句话」→语音；说「别发语音，打字」→文字（优先级最高）
  - 其余交给 Jev 判（text/voice + 置信度，<0.6 保持文字）
  - `qce reply <文本> --to <id> [--incoming-voice] [--incoming-text <内容>] [--force-text|--force-voice]`
  - 实测：四类场景判定全对；语音链路用本地克隆音色端到端送达
- **可靠性内核**（`src/core/reliability.ts`，23 单测）
  - `withTimeout` / `withResilience`（指数退避 + ±25% 抖动）/ `CircuitBreaker`（按 key 独立计数、半开探针）/ `DeadLetterQueue`（落盘不丢消息）
  - `qce dlq` 查看死信、`--replay <id>` 重放、`--clear` 清空
- **watcher v2：断点续传 + 可靠性**（`private/lib/watch-state.mjs`，13 单测）
  - 状态**原子写入**（先写 .tmp 再 rename）：断电/强杀不会留下半个 JSON
  - 状态损坏时自动备份 `.corrupt-<ts>` 并重建，不让 watcher 起不来
  - 水位按会话存（p<QQ>/g<群号>）+ message id，**重启从上次位置继续**，不重投不漏投
  - v1 状态自动迁移到 v2（保留水位）
  - 投递失败自动重试（3 次，指数退避）；超过次数进 `output/qq-watch.dlq.jsonl`，`--replay-dlq` 可重放
  - 熔断：连续失败 5 次暂停投递 60s
  - **回补窗口 `catchUpHours`（默认 168h）**：关机再开机，窗口内的漏消息会被追回；超窗的才丢弃
  - v1 状态字段 `lastTime` → v2 `cursors`

### Fixed

- watcher 崩溃恢复：状态文件损坏时不再整个起不来

## [0.21.0] - 2026-11-06

### Added

- **群成员画像**（`src/core/member-profile.ts` + `qce profile`）
  - 从历史聊天统计：发言量、活跃时段、高频词、口头禅、常互动的人——**可解释的统计，不是模型猜的**
  - 实测群 913807639：4625 条消息 / 22 人；冷峰沉睡 1276 条、糯米天师 1013 条
  - `qce profile <群号> --save --memory`：存 `private/profiles/` 并写进长期记忆（权重 0.85，衰减慢）
  - 画像块注入 group-bot 上下文（与群人格一起），并明确「可信但不要在回复里念出来」
- **本地克隆音色跑通**（GPT-SoVITS v2）
  - `qce tts --provider local` 实测：合成 → AMR → QQ 语音条送达
  - 环境：torch 2.11.0+cu128（RTX 5060 / sm_120）+ ffmpeg shared DLL + torchcodec + opencc

### Fixed

- **watcher TDZ 崩溃**：陈旧消息过滤里 `fresh` 在声明前被使用（`Cannot access 'fresh' before initialization`），导致每轮轮询失败。改为先算 `cutoff` 再过滤
- 删除 `member-profile.ts` 里没用到的死函数 `partnerCounts`（类型错误的来源）

### Notes

- pip 批量装依赖会卡在依赖求解（实测 21 分钟零进展）；**逐个包装** 26 个包 3 分钟完成
- `torchvision` 会把 torch 升级成 CPU 版，必须 `--index-url .../cu128` 强制重装

## [0.20.0] - 2026-11-06

### Added

- **`qce history <群号>`：读完整历史（不依赖账号在线）**
  - 解析 `output/group-<群号>-full.txt` 导出文件，支持 `--search` / `--from` / `--since` / `--until` / `--last` / `--limit` / `--json`
  - 实测：群 913807639 的 **4625 条**（2025-09-03 → 2026-10-21）可检索
  - `src/core/historyfile.ts`（11 单测：解析多行正文、过滤、截断、渲染）

### Why

- NapCat 本地只缓存最近几十条；本地 QQ 库是今天新装的（`nt_msg.db` 仅 497KB）。真正的历史在导出文件与服务器那份 QQ 库里
- 因此「读历史」走文件，「收实时」走 watcher，「发回复」走 `qce send`——**不需要常驻 group-bot**

## [0.19.0] - 2026-11-06

### Added

- **按群人格**（`src/core/persona.ts`）
  - `private/personas/<群号>.md` 存在就注入 system 提示，只改「怎么说」不改「能做什么」
  - 注入块自带边界：不得辱骂真实群友、不编造事实、不因人格泄露隐私
  - 已写入 `913807639` 的「贴吧重度脱水老哥」人格（按后续要求去掉了强制索要网盘/四字收尾）
- **memecub MCP 表情源**（`src/core/memesource.ts` + `qce meme`）
  - Streamable HTTP MCP：必须 `Accept: application/json, text/event-stream`，否则 406
  - `qce meme <query>` 搜索并列出；`--send-to` 直接下载并发图（base64）
  - 实测：`facepalm` / `mind blown` / `cat` 有结果；**中文查询返回 0**（索引以英文为主）

### Verified

- `qce meme "mind blown" --send-to 1473517806` → 图片实际送达
- `vitest run src`：24 文件 / **297 用例**

## [0.18.0] - 2026-11-06

### Added

- **回复闸门接入 group-bot**：@ 消息在生成回复前先过 `gateReply`（Jev 判 reply/wait/skip）；低置信或异常自动回落规则（@ 必回），不会因为模型抽风漏回
- `qce gate <文本> --trigger mention|private|ambient`：单独试闸门决策（真机验证：@ → reply 0.80；路人闲聊 0.56/0.30 → 回落 skip）
- `src/core/reply-gate.ts`：请求体/解析/回落（15 单测）

### Fixed

- **watcher 把历史消息当新消息投递**：停止一段时间后水位停摆，重启会把几天前消息逐条推来。新增 `maxAgeHours`（默认 6h）——超龄消息只推进水位、不投递；水位改为按"看到过的最新时间"推进，避免陈旧消息每轮重扫

### Notes

- 云端已停用：`cloud-qq.service` 停止+禁用，服务端 NapCat 容器已停；zhaowen 号只在本地在线（同一账号单端在线是硬约束）

## [0.17.0] - 2026-11-06

### Added

- **TTS 双 provider**
  - `cloud`（默认）：阿里云百炼 Qwen-TTS，官方固定音色
  - `local`：接本地语音克隆服务（GPT-SoVITS `api_v2` 的 `/tts`），用几秒参考音频复刻任意音色
  - `qce tts <文本> --provider local --endpoint http://127.0.0.1:9880 --ref-audio ./ref.wav --prompt-text "参考音频里的原话"`
  - 两条路共用同一套「转 AMR → base64 发 record」的发送链路

### Verified

- `vitest run src`：21 文件 / **246 用例**（新增 5 个本地 provider 用例：成功/空文本/空端点/服务报错/空音频/落盘）

## [0.16.0] - 2026-11-06

### Added

- **语音合成 `qce tts`**（阿里云百炼 Qwen-TTS，模型 `qwen3-tts-flash`）
  - 文字 → wav → ffmpeg 转 **AMR**（QQ 语音条可用）→ 发成 `record` 段
  - 关键坑：NapCat 对 `file://` 语音转码会失败，**必须用 `base64://`**；wav 不认，必须转 AMR/mp3
  - 找不到 ffmpeg 时明确提示并退回原始文件
- **表情自动收集 `qce face collect <群号>`**
  - 扫本地索引里带图片的消息 → 按内容 sha256 去重 → 写候选目录 → `--apply` 才并入表情库
  - 候选目录也参与去重，重复扫不会重复报；`--dry` 只看不收
- **主动聊天 `qce proactive`**
  - 纯决策引擎：免打扰时段（支持跨零点）/ 最小间隔 / 每日上限 / 概率触发 / 冷场判定（13 个单测）
  - `run` 支持 `--dry` 与 `--text`（不给就用最重的长期记忆当话题）；状态持久化到索引目录

### Verified（真实链路）

- TTS：合成 → AMR → 发送成功，QQ 端收到语音条
- 表情收集：群 913807639 扫到 2 张图，去重后并入表情库（232 → 234）
- 主动聊天：决策 → 实际发出 → 状态落盘
- `vitest run src`：20 文件 / **241 用例**

### 生态处置（本轮补充）

- `astrbot_plugin_proactive_chat` 是 AGPL-3.0：只借鉴「免打扰 + 概率 + 间隔」的设计，代码自行实现
- `astrbot_plugin_meme_manager`（MIT）：借鉴自动收集思路，实现独立
- `dafeiyu-astrbot`（MIT）：TTS 走同一家百炼，端点与模型名经实测确定

## [0.15.0] - 2026-11-06

### Added

- **会淡忘的长期记忆（练自 dsh-fish-memory 的机制，重写实现）**
  - `src/core/memory.ts`：半衰期衰减（默认 30 天减半）/ TTL 淘汰（默认 180 天）/ 复习效应（召回后重新计时）/ 低权重过滤 / 关键词与 scope 过滤（20 个单测）
  - `qce memory`：`add` / `recall` / `list` / `stats` / `forget`
  - **接入对话上下文**：`group-context` / `private-context` 的 `buildAgentInput` 会把该 scope 下最要紧的 5 条注入，且排在「仅数据」包裹之前
- **MCP `recall_memory`（只读）/ `remember_memory`**
  - `remember_memory` **默认禁用**，需 `MCP_ALLOW_MEMORY_WRITE=1`：长期记忆会持续进入上下文，等于可持久化的提示词注入通道，不能给模型默认写权限
  - 单条长度上限 500 字

### Notes（生态调研结论）

- `dsh-fish-memory`（★483, JS）：只借鉴半衰期淡忘的思路，未复制代码
- `astrbot_plugin_proactive_chat`（★524）是 **AGPL-3.0**，代码不可并入 MIT 项目，只参考设计
- `astrbot_plugin_meme_manager`（★548, MIT）：自动收集思路可借鉴，我们已有表情库 + Jev 选择
- QQ 空间：原 `Zhalslar/astrbot_plugin_qzone` 已 404，社区替代为 `qzone_ultra`（★59）；我们已有 `qzone` 命令，无需引入
- `dafeiyu-astrbot`（★729, MIT）：整套部署全家桶，不是可复用模块；TTS 部分可作为下一步参考

### Verified

- `qce memory add/recall/stats` 实跑：两条记忆按 0.90 / 0.80 权重召回
- MCP：`recall_memory` 返回带 score 的记忆；`remember_memory` 返回「记忆写入已在服务端禁用」
- `vitest run src`：17 文件 / **207 用例**

## [0.14.0] - 2026-11-06

### Added

- **MCP `send_sticker` 工具**：用 `intent` 让 **Jev（TypeSafe System One）决策模型**从本地表情库（232 张）里挑一张，或直接给 `stickerId`
  - `src/core/sticker.ts`：候选构造、Jev 请求体、答案校验（choice 必须是候选之一）、关键词兜底（14 个单测）
  - 两阶段确认与 `send_message` 一致；摘要里带**具体表情 label**，确认时看得出是哪一张
  - 群发同样默认禁用；发送前过 `safety` 白名单
  - 没有 `JEV_API_KEY` / 接口失败 → 自动回退关键词，不会卡住

### Verified（真实链路）

- Jev 实测：`完全无语` → 选中「熊猫头 挺好的 嘲讽 无语 敷衍」（conf 0.98，749–1091ms）；`庆祝胜利` → conf 0.86
- MCP 端到端：第一阶段返回 `待确认：…表情「熊猫头…」（jev，id e907c9d5…）` → 第二阶段返回 `{"ok":true,"stickerId":"e907c9d5…"}`，表情实际送达 1473517806
- `vitest run src`：16 文件 / **182 用例**

## [0.13.0] - 2026-11-06

### Added

- **MCP `send_message` 工具**
  - **两阶段确认**：第一次调用只登记并返回摘要 + `confirmation_token`（`ctk_*`，5 分钟有效、与 kind/target/text 绑定），第二次带令牌才真正发送；内容被改动、令牌过期、令牌无效都会被拒
  - **群发默认禁用**：`MCP_ALLOW_GROUP_SEND=1` 才打开，避免模型在无人看管时往群里发东西
  - **走 safety 白名单**：目标必须已 `qce safety allow`，否则直接报错且不发送
  - 令牌只存在进程内存，MCP 进程退出即失效

### Verified（真实链路）

- MCP stdio 实测：`tools/list` 返回 4 个工具；`send_message` 群发被拒；私聊两阶段 → 第二阶段返回 `{"ok":true,"kind":"private","target":1473517806}`，消息实际送达
- `vitest run src`：15 文件 / **164 用例**（新增 8 个 send_message 用例）

## [0.12.0] - 2026-11-06

### Added

- **语音转写**
  - `qce asr <文件...>`：单独转写本地音频（`--json` 输出结构化结果）
  - `qce index <群号> --asr`：把群里的语音条转成文字，生成 `asr:<消息id>:<序号>` 合成消息并入索引 —— 之后 `search` / `digest` / 语义检索都能覆盖语音内容
  - 离线优先：`scripts/asr_audio.py` 用 faster-whisper 加载**本地已缓存**模型（`QCE_ASR_MODEL` 可换，默认 small），设置 `HF_HUB_OFFLINE=1` 避免无网时卡在下载
  - 纯函数 `src/core/asr.ts`（9 个单测）；解释器复用 OCR 的 `resolvePython()`

### Verified

- 真实音频：`qce asr 语音_16.mp3` → `看見你瘦了,你瘦了你不肯吃飯了`（9.26s 音频，模型 small，离线）
- `vitest run src`：15 文件 / **156 用例**

### Known limitation

- 群 `913807639` 当前缓存窗口内没有语音消息，`index --asr` 的真实群数据尚未验证（等群里出现语音条）

## [0.11.0] - 2026-11-06

### Fixed

- **图片 OCR 静默失败**：`get_image` 返回的是本地缓存路径（`...
t_data\Pic\...`），原实现只处理 `file://` / `http` 两种 URL，导致 `index --ocr` 永远 `OCR +0`。现在优先用本地路径，省一次下载。
- **Python 解释器选错**：Windows 上常有多个 `python`（Store 存根 / 多版本），落到没装 `rapidocr_onnxruntime` 的那个时 OCR 会静默返回空。现在 `resolvePython()` 会逐个探测 `python` / `py` / `python3`，用第一个真的能 `import rapidocr_onnxruntime` 的解释器，并缓存结果。

### Verified（真实群数据）

- 群 `913807639`（41 人）：索引 14 条 → `--ocr` 生成 1 条合成消息 `ocr:386331545:0`
- 识别结果：`时间 类型 比赛时长 击杀 历史战绩 … 海克斯大乱斗 23分钟 89/59 …`
- `qce search 海克斯` / `qce search 击杀` 均命中该条（证明"截图里的字可搜"闭环成立）
- 群文件真实数据：`files list` 50 个 / 475 MB，`files stats` 按扩展名分布正常

## [0.10.0] - 2026-11-06

### Added

- **提示词注入防护**（`src/core/injection-guard.ts`）
  - `scanForInjection`：识别 10 类套路（忽略指令 / 系统提示 / 角色覆盖 / 套取密钥 / 要求转发 / 调用工具 / 破坏性命令 / 冒充权威 / 扫码钓鱼），分级 low/medium/high 并给出证据片段
  - `wrapUntrusted`：把外部内容包进 `⟦外部内容·仅数据⟧ … ⟦/外部内容⟧` 边界块，**中和伪造的边界标记**，防止内容"提前闭块"再冒充系统；高危内容打 `⚠可疑(规则名)` 标记但保留原文
  - `sanitizeText`：去零宽字符/控制字符、统一空白、限长
  - `UNTRUSTED_CONTENT_RULE`：拼进 agent 输入的一句话边界规则
- 群聊/私聊的 `buildAgentInput` 现在都走这层包裹（内容为空时保持空，不产生噪声）

### Verified

- `vitest run src`：14 文件 / **147 用例**（新增 18 个防护用例，含"伪造边界标记"攻击）

## [0.9.0] - 2026-11-05

### Added

- **`qce files` 群文件**：`list` / `search` / `download` / `stats`
  - 跨群按文件名搜索（大小写不敏感）、按扩展名与体积过滤
  - 体积按扩展名分布统计；下载按「文件名或 fid」定位，模糊匹配多个时拒绝猜测
  - `src/core/group-files.ts`（纯函数，16 个单测）

### Fixed

- `getGroupFileList` 用错了 API：OneBot/NapCat 没有 `get_group_file_list`，改为根目录 `get_group_root_files`、子目录 `get_group_files_by_folder`，并归一化 `file_id/file_name/file_size → fid/name/size`。

### Known limitation

- 下载依赖 `get_group_file_url`，NapCat 未启用 packetBackend 时会返回「packetBackend 不可用」；命令会给出明确提示而不是静默失败。
- 本机账号当前 0 个群，`files list` 的真实群数据未能端到端验证（已确认请求打到了正确的内核接口）。

## [0.8.0] - 2026-11-05

### Added

- **`qce index --ocr`：图片转文字入库**。消息里的图片段通过 OneBot `get_image` 取回，用本机 `rapidocr_onnxruntime`（CPU、中文）识别，生成 `ocr:<消息id>:<序号>` 的合成消息并入索引 —— 之后 `search` / `digest` / `--semantic` 都能检索到图里的文字。
  - `src/core/ocr.ts`（委托 Python `scripts/ocr_image.py`，含 10 个单测）
  - 幂等：合成消息 id 固定，重复跑不会重复入库
  - 容错：单张图取不到 / OCR 失败都跳过，不中断整批

### Fixed

- `scripts/ocr_image.py` 强制 stdout 为 UTF-8：Windows 下 Python 默认 GBK 会把中文写成替换符

### Verified

- 真实图片（PIL 生成的「明天下午三点开会 / 会议室在三楼 302」）→ OCR 出 2 行，码点校验为正确中文（`0x660e 明天下午三点…`）
- `vitest run src`：12 文件 / **113 用例**；`tsc` 通过

## [0.7.0] - 2026-11-05

### Added

- **`qce alert` 关键词告警**：`add` / `list` / `remove` / `run`，支持关键词与正则、按群限定、冷却窗口、`--offline` 离线扫描、`--dry` 预演。
  - 命中后把「群 + 发送者 + 原文片段」发到指定 QQ（走 `safety` 白名单）
  - 幂等：按「规则 id + 消息 id」记录，重启/重复执行不会重复提醒
  - 规则与状态存 `~/.qchat-cli/index/alerts.json`（`AlertStore`，14 个单测）

### Verified

- 真机链路：索引造 3 条消息 → 两条规则命中 → 实际发出 2 条 QQ 提醒 → 再跑一次「无命中」（幂等成立）
- `vitest run src`：11 文件 / **103 用例**
- `tsc` 通过

## [0.6.0] - 2026-11-05

### Added

- **`qce digest --send-to <QQ号|群号>`**：日报生成后直接发到 QQ（私聊发紧凑文本摘要，群聊优先上传完整 `.md`，失败退回文本）。走现有 `safety` 白名单，需先 `qce safety enable` + `qce safety allow`。
- **`qce digest --from-index`**：不联网，直接用 `qce index` 建的本地索引出日报（离线可用，也方便回放历史）。
- `renderDigestText()`：把日报渲染成适合 QQ 的纯文本（Markdown 在 QQ 不渲染），超长自动截断。

### Verified

- 真实发送：`qce digest 123456789 --from-index --send-to 1473517806` → 消息实际送达 QQ
- 89 个单测通过；`tsc` 通过

## [0.5.0] - 2026-11-05

### Added

- **语义检索**：`qce index <群号> --embed` 调阿里云百炼 `text-embedding-v4`（OpenAI 兼容端点，与 weflow-cli 同款）为每条消息生成 1024 维向量；`qce search <词> --semantic` 按余弦相似度排序，`--min-score` 控制阈值（默认 0.45）。
  - `src/core/embeddings.ts`：分批（≤25）+ 失败重试一次 + Float32 ⇄ base64 紧凑存储（17 个单测）
  - `src/core/vector-store.ts`：按群 JSONL 存向量、同 id 覆盖、top-k 检索（含 5 个 store 单测）
  - key 通过 `DASHSCOPE_API_KEY`（或 `QCE_DASHSCOPE_KEY`）注入，不落 Git
- 检索链路降级：缺 key / 向量库为空 / 接口报错 都会明确提示并退回关键词检索，不会静默给空结果。

### Verified

- 真实调用（dim=1024）：`谁写完了论文` → 命中论文消息 0.63；`晚上有什么吃的` → 命中食堂红烧肉 0.47（关键词完全打不中）；`三点在哪集合` → 命中会议室三楼 0.52

## [0.4.0] - 2026-11-05

### Added

- **本地增量索引 `qce index`**：把群消息落到 `~/.qchat-cli/index/group-<id>.jsonl`，按 message_id 去重、按时间排序；`--all` 批量更新、`--stats` 看概览、`--clear` 清空。
  - `MessageStore`（`src/core/message-store.ts`，7 个单测）；主目录不可写时自动退到工作目录 `./.qce-index`，不会直接崩
- **`qce search` 改读本地索引**：命中毫秒级，`--refresh` 才联网增量更新；首次无索引时自动建。
- **`qce digest --push <email>`**：日报生成后直接发邮件，走本机 `agently-cli`（`--push-dry` 只打印命令）。
  - 参数构造抽成 `src/core/push.ts`（纯函数，5 个单测）
- MCP 的 `search_messages` 改为读本地索引，`group_digest` 拉取时顺带入索引。

### Changed

- 索引目录可用 `QCE_INDEX_DIR` 覆盖；`.qce-index/` 已加入忽略列表。

## [0.3.0] - 2026-11-05

### Added

- **`qce search` 本地检索**：中文按二元组切分（不依赖分词词典），支持 `--group` / `--since 7d` / `--from` / `--limit` / `--json`，输出带上下文片段。
  - 纯函数核心 `src/core/search-index.ts`（16 个单测），公共拉取模块 `src/core/history.ts`（分页 + 去重 + 消息段拍平，digest / search / mcp 共用）
- **`qce mcp` MCP server**（stdio，newline-delimited JSON-RPC）：暴露三个只读工具 `search_messages` / `group_digest` / `list_groups`，可直接接 Claude Code、Cursor 等客户端。
  - 协议处理与数据源解耦（`McpBackend` 注入），10 个单测覆盖 initialize / tools / 错误路径 / 通知不回包
  - stdout 只输出 JSON-RPC，日志一律走 stderr

### Changed

- README（中/英）新增「本地搜索 + MCP 接入」用法与客户端配置示例。

## [0.2.0] - 2026-11-05

### Added

- **`qce digest` 群日报**：把一段群聊压成一页 Markdown —— 消息量 / 参与人数 / 发言榜 / 24 小时活跃柱状图 / 值得回看（长文·链接·点名·附件）/ 分享过的链接 / @全体 次数。`--ai` 可复用 `private/group-bot.config.json` 的模型生成要点摘要，失败自动降级。
  - 纯函数实现（`src/core/digest.ts`），带 7 个单测
  - 分页拉取群历史并按 `message_id` 去重
- **`docker-compose.yml` + `.env.example`**：一条命令起 NapCat（端口只绑 `127.0.0.1`，`restart: unless-stopped`）。
- **`docs/napcat.md`**：Docker / Windows Shell / 已有 OneBot 三种接法，含"新号首次登录只生成空 `httpServers` 配置"等 5 个常见坑。
- **`README.en.md`**：英文版 README。
- 终端演示图 `docs/images/demo.png`（由本机真实命令输出渲染）。

### Changed

- README 首屏重写：价值定位（"能回答 QQ 回答不了的几个问题"）+ 真实终端输出 + 三种典型用法；隐私安全与 AI 机器人边界内容保留并重组。
- 仓库补齐 description 与 topics（`qq` / `onebot` / `napcat` / `chat-export` / `ai-agent` / `mcp` 等），提升可发现性。
- 安装流程改为「先 compose 起 NapCat，再装 qce」。

### Fixed

- `.gitignore` 只忽略 `.qzone-cookie`，实际文件是 `.qzone-cookie.<QQ号>` 变体 → 改为 `.qzone-cookie*`，避免敏感 cookie 误提交。
- 忽略本地 `_seed/`、`napcat-boot.log*`、`.tmp-vitest/`。

## [0.1.0] - 2026-08

### Added

- OneBot 11 接入、聊天记录导出（JSON/TXT/HTML/CSV/Markdown）
- 实时消息监听（WebSocket / 轮询）
- 受限发送与安全白名单（`qce safety`）
- 群管理、QQ 空间操作
- 单群隔离机器人（`group-bot`）与私聊机器人（`private-bot`，`single` / `split`）
- 用户画像（从聊天与空间内容生成）
