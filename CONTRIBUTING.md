# 贡献指南

感谢你对 qchat-cli 有兴趣！我们欢迎所有形式的贡献。

---

## 目录

- [开发环境配置](#开发环境配置)
- [提交代码](#提交代码)
- [代码规范](#代码规范)
- [测试](#测试)
- [Issue 报告](#issue-报告)
- [Pull Request 流程](#pull-request-流程)

---

## 开发环境配置

### 前置要求

- Node.js 18+
- npm 或 pnpm
- Git

### 本地开发

```bash
# 1. Fork 并克隆
git clone https://github.com/你的用户名/qchat-cli.git
cd qchat-cli

# 2. 安装依赖
npm install

# 3. 链接到全局（便于测试）
npm link

# 4. 编译 TypeScript
npm run build

# 5. 监听并自动编译
npm run watch
```

---

## 提交代码

### 分支命名

| 分支类型 | 示例 | 说明 |
|----------|------|------|
| 功能 | `feature/add-new-api` | 新增功能 |
| 修复 | `fix/duplicate-reply` | 修复 Bug |
| 文档 | `docs/update-readme` | 文档改动 |
| 重构 | `refactor/core-module` | 重构代码 |

### 提交信息规范

请遵循 [Conventional Commits](https://www.conventionalcommits.org/) 格式：

```
<type>(<scope>): <subject>

<description>
```

#### Type 类型

| 类型 | 说明 |
|------|------|
| `feat` | 新功能 |
| `fix` | 修复 Bug |
| `docs` | 文档更新 |
| `style` | 代码格式（不影响功能） |
| `refactor` | 重构（非功能、非修复） |
| `perf` | 性能优化 |
| `test` | 添加测试 |
| `chore` | 构建/工具类改动 |

#### 示例

```
feat(onebot): add sendGroupMessage API

新增群组消息发送方法，支持消息段数组
```

```
fix(monitor): prevent duplicate replies

修复重复回复问题，添加 message_id 去重机制
```

---

## 代码规范

### TypeScript 规范

- 尽可能使用严格类型
- 避免使用 `any`，必要时使用 `unknown`
- 使用 `async/await` 而非 Promise 链式调用
- 函数单一职责

```typescript
// ✅ 推荐
async function getMessageList(
  sessionId: number,
  limit: number = 20
): Promise<Message[]> {
  // ...
}

// ❌ 不推荐
function getMsgList(id: any, limit?: any) {
  return new Promise((resolve, reject) => { ... })
}
```

### 文件组织

```
src/
├── commands/          # CLI 命令
│   └── [功能].ts
├── core/              # 核心模块
│   ├── onebot-client.ts
│   ├── qzone-client.ts
│   ├── audit.ts
│   └── ...
└── utils/             # 工具函数
    └── index.ts
```

### 导出规范

```typescript
// ✅ 命名导出（推荐）
export class AuditLogger { /* ... */ }
export function fetchWithTimeout() { /* ... */ }

// 使用时
import { AuditLogger, fetchWithTimeout } from './utils'
```

---

## 测试

> ⚠️ 目前测试正在完善中，欢迎贡献！

### 运行测试

```bash
# 运行所有测试
npm test

# 运行特定文件
npm test -- tests/onebot.test.ts

# 监听模式
npm run test:watch
```

### 测试文件结构

```
tests/
├── unit/
│   ├── onebot-client.test.ts
│   ├── qzone-client.test.ts
│   ├── audit.test.ts
│   └── danger.test.ts
└── integration/
    └── commands.test.ts
```

---

## Issue 报告

### Bug 报告

请使用模板：

```
## 描述问题
清晰描述问题是什么。

## 复现步骤
1. 运行 '...'
2. 看到 '...'

## 预期行为
你期望的正确行为是？

## 环境信息
- Node.js: v18.16.0
- 操作系统: Windows 11 / macOS 13
- 浏览器 (如适用): Chrome 116

## 截图/日志
```

### 功能请求

```
## 需求描述
你想要什么功能？

## 使用场景
在什么场景下需要这个功能？

## 替代方案
你试过其他方案吗？
```

---

## Pull Request 流程

### 1. 准备 PR

- 确保你在自己的分支上开发
- 提交信息符合规范
- 代码通过编译和 lint

### 2. 提交 PR

```bash
# 推送到你的 Fork
git push origin feature/add-new-api

# 在 GitHub 创建 PR
```

### 3. PR 检查清单

- [ ] 代码已编译：`npm run build` 无报错
- [ ] 测试通过（如有）
- [ ] 文档已更新（README、API.md 等）
- [ ] 提交信息符合规范
- [ ] 已通过 Code Review

### 4. Code Review

- PR 至少需要 1 个 Approval
- 如有问题会提出修改建议
- 修复后可以重新提交

---

## 欢迎的贡献类型

- 🐛 Bug 修复
- ✨ 新功能
- 📖 文档改进
- 🔧 代码重构
- ⚡ 性能优化

---

## 社区准则

- 友善对待每一个贡献者
- 尊重不同的技术选择
- 保持专业和建设性

---

## 有问题？

欢迎开 Issue 讨论！

---

## License

通过贡献代码，你同意你的贡献将在项目的 [MIT 许可证](./LICENSE) 下发布。
