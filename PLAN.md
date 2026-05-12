# qchat-cli 开发规划

> 已实现功能详见 [README.md](./README.md) 和 [WORKFLOW-REPORT.md](./WORKFLOW-REPORT.md)

---

## P0 — 缺陷修复

| # | 任务 | 说明 | 状态 |
|---|------|------|------|
| 1 | 删评论 API | 需从 QZone 网页端抓包获取真实端点（`emotion_cgi_del_reply` 不工作） | 🔴 待抓包 |
| 2 | `qce qzone comment` 参数顺序 | 当前 `<uin> <tid> <content>`，改为 `<tid> <content> [uin]` 更自然（自己说说时可省略 uin） | 🟡 待优化 |

---

## P1 — 多账号管理

**目标**：一套命令管理多个 QZone 账号的 cookie，一键切换。

```bash
qce qzone profile add <名称>        # 扫码登录，保存为命名 profile
qce qzone profile list              # 列出所有 profile（含 UIN、昵称、有效期）
qce qzone profile switch <名称>     # 切换到指定 profile
qce qzone profile remove <名称>     # 删除 profile
qce qzone profile current           # 查看当前使用的 profile
```

**设计要点**：
- `.qzone-cookie` → `private/profiles/<名称>.json`
- 切换时软链接或复制 cookie 到 `.qzone-cookie`
- `private/qzone-ops.mjs` 增加 `--profile <名称>` 参数

**预计工作量**：~2 小时

---

## P2 — 聊天记录搜索

**目标**：通过 qce-bridge 直接搜索聊天记录，无需预先导出。

```bash
# 基础搜索
qce search <QQ号> "关键词"                    # 按内容搜索，返回匹配消息列表

# 高级筛选
qce search <QQ号> "关键词" --after 2026-01-01  # 日期范围
qce search <QQ号> "关键词" --before 2026-05-01
qce search <QQ号> "关键词" --sender "昵称"     # 按发送者
qce search <QQ号> "关键词" --context 5          # 每条结果带前后 5 条上下文
qce search <QQ号> "关键词" --format html        # 搜索结果导出为 HTML

# 聊天记录查看器（交互式）
qce log <QQ号>                    # 分页浏览聊天记录（类似 less）
qce log <QQ号> --after 2026-01-01
```

**设计要点**：
- 拉取全量消息 → 内存过滤（qce-bridge 本身不支持搜索）
- 大小写不敏感、支持中文分词
- 搜索结果高亮关键词
- 可导出为 HTML（高亮 + 上下文）

**预计工作量**：~3 小时

---

## P3 — 功能增强

| # | 任务 | 说明 | 工时 |
|---|------|------|------|
| 3 | QZone 相册导出 | `qce qzone album export <相册ID>` → HTML（图片 base64） | 3h |
| 4 | 说说统计面板 | `qce qzone stats [QQ号]` — 按月/年统计发帖数、互动数、活跃好友 | 2h |
| 5 | 评论点赞开关 | `qce qzone like-comment <uin> <tid> <commentId>` — 给评论点赞 | 1h |
| 6 | 一键补赞所有好友 | `npx tsx private/qzone-ops.mjs like-all` — 遍历 `qzoneTargets` 全部补赞 | 0.5h |
| 7 | 关键词监控告警 | `private/keyword-alert.mjs` — 检测到指定关键词时桌面通知 | 2h |
| 8 | 导出格式扩展 | 新增 PDF 导出、纯文本时间线导出 | 2h |

---

## P4 — 体验优化

| # | 任务 | 说明 | 工时 |
|---|------|------|------|
| 9 | TS 类型错误修复 | inquirer 类型声明、monitor.ts getConfig 问题 | 1h |
| 10 | `npm run build` 修复 | 解决 TS 编译错误，产生可用 dist/ | 1h |
| 11 | 扫码图片自动弹窗 | Windows/macOS 自动打开二维码（已部分实现） | 0.5h |
| 12 | 进度条美化 | 批量操作时显示 `ora` spinner 和百分比 | 1h |
| 13 | README Logo | 补充项目 Logo 图片 | 待定 |

---

## P5 — 远期想法

- **Web Dashboard**：本地 Web 界面管理多账号、查看统计、搜索聊天记录
- **定时任务调度器**：内置 cron，定时导出/备份/补赞
- **QQ 空间迁移工具**：A 账号 → B 账号批量迁移说说（复制内容+图片）
- **AI 对话摘要**：调用 Claude API 生成与某人的聊天摘要/情感分析

---

## 实现顺序建议

```
P0 删评论 → P1 多账号 → P2 聊天搜索 → P3 按需 → P4 顺手 → P5 再说
```

---

*最后更新: 2026-05-12*
