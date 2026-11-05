# Changelog

所有值得记录的变更。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本遵循 [SemVer](https://semver.org/lang/zh-CN/)。

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
