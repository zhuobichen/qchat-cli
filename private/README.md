# 隐私操作目录

本目录存放包含个人 QQ 号等私密信息的脚本和配置，**不提交到 Git**。

## 初始化

```bash
cp private/config.example.json private/config.json
```

然后编辑 `private/config.json`，填入你的信息：

```json
{
  "myQQ": 你的QQ号,
  "monitoredFriends": [监听的好友QQ号列表],
  "monitoredGroups": [监听的群号列表],
  "qzoneTargets": {
    "好友昵称": QQ号,
    "另一个": QQ号
  }
}
```

## 可用脚本

| 脚本 | 用途 |
|------|------|
| `qzone-ops.mjs feeds <名称>` | 查看某人全部说说 |
| `qzone-ops.mjs check <名称>` | 逐条检查点赞状态 |
| `qzone-ops.mjs like <名称>` | 检查+批量补赞 |
| `qzone-ops.mjs export <名称>` | 导出为 HTML（含评论） |
| `monitor-live.mjs` | 实时监听+人格回复 |
| `monitor-notify.mjs` | 轻量监听→pending-messages.json |

## 使用

```bash
cd E:/CodeProject/qchat-cli

# QZone 操作
npx tsx private/qzone-ops.mjs export 郭楠

# 消息监听
npx tsx private/monitor-notify.mjs
```

> ⚠️ `private/config.json` 含 QQ 号，已在 `.gitignore` 中排除。不要提交到 Git。
