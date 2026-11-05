# Changelog

所有值得记录的变更。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本遵循 [SemVer](https://semver.org/lang/zh-CN/)。

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
