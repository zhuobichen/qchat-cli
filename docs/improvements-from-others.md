# qchat-cli 可借鉴的同类项目做法

> 调研对象：NoneBot2、Koishi、云崽（Miao-Yunzai）、OneBots / imhelper、NapCat。
> 基线：qchat-cli `src/`（149 个 TS 文件，36 个测试文件）、`ARCHITECTURE.md`、`src/core/mcp-server.ts`（16 个 MCP 工具）、`src/commands/tools.ts`（`qce say/pic/media/see`）、`src/commands/dispatch.ts` + `scripts/dispatch.mjs`（派活车道）。
> 调研方式：读了各项目源码/设计文档的关键文件（下文逐条标注文件名），**没有运行过这些项目**；凡是只看到 README 宣传、或来自二手转述的，都标了「待验证」。

---

## 0. 先说结论（三句话）

1. **最值得借的三件事**：OneBots 的「有序投递队列 + 事件去重」、NoneBot 的「规则/权限声明式 + 会话续接」、云崽的「插件级冷却与黑白名单」。它们解决的是 qchat-cli 现在**真实存在**的漏洞，不是架构洁癖。
2. **最不该借的**：Koishi 式的服务容器 + 全量热重载、NoneBot 式的依赖注入框架。收益主要是「插件作者体验」，而 qchat-cli 没有外部插件作者，改造成本 > 收益（详见各节「不能借」）。
3. **当前架构最疼的一处**：`safety.ts` 的白名单是**会话粒度**（群号/QQ 号），而 `tools.ts` 里的「像人一样发消息」限速（`MAX_PER_MINUTE = 10`）只在 CLI 层裸调时生效——**群机器人一旦走的是另一条路，两条路的权限与限速各算各的**。这一条比任何「插件化」都更该先修。

---

## 1. NoneBot2（Python）

**读了**：`nonebot/plugin/model.py`（Plugin / PluginMetadata）、`nonebot/plugin/manager.py`（PluginManager、PluginFinder/Loader）、`nonebot/internal/matcher/matcher.py`（Matcher.new、receive/got/pause/reject、priority/block、temp Matcher 续接）、`nonebot/dependencies/__init__.py`（Dependent 参数注入）。

### 它的核心抽象
- **Matcher**：一个「事件响应器类」，声明 `type`（事件类型）、`rule`（匹配规则）、`permission`、`priority`、`block`（是否阻止事件继续传播）。
- **Dependent（依赖注入）**：处理函数的参数由框架按类型注（`BotParam/EventParam/StateParam/ArgParam`…），`receive()/got()` 用**抛出 `PausedException` + 新建 temp Matcher** 实现「等用户下一条消息再继续」。
- **Plugin / PluginMetadata**：插件是模块，`__plugin__` 与 `__plugin_meta__` 里放着名称、描述、用法、配置 schema、支持的 adapter；`PluginManager` 通过 `MetaPathFinder`/`PluginLoader` 接管 import 过程，这样「插件被 import 之前」就能被登记。

### 它解决什么问题
多人在同一个「事件流」上抢着响应时的**秩序问题**：谁能接、按什么顺序接、接完要不要拦下游、怎么追问用户下一个参数、怎么在下一次回复时接着上次的上下文。

### qchat-cli 现在怎么做
- 事件不是广播的，是**每个常驻命令自己 `client.on('message_group', ...)` 里做 if 判断**：`src/commands/group-bot.ts:130` 与 `src/commands/private-bot.ts:190` 各自订阅、各自过滤，逻辑互不知情（各存一份 `follow-up` 窗口、各有一套 memory）。
- 「是否该接话」由 `src/core/reply-gate.ts` 的 `gateReply()` 决定——**已经是 NoneBot 里 rule+permission 的等价物，而且带模型兜底**，设计上不落后。
- 「追问下一条」在群机器人里是用 `awaitingFollowUp: Map` + `FOLLOW_UP_WINDOW_MS = 30_000` 手写的（`group-bot.ts:19,92`）。

### 能不能借
| 项 | 判断 | 理由 |
|---|---|---|
| Matcher 的 `priority` + `block` 事件传播模型 | **能借（概念，不搬代码）** | 现在两个 bot 命令各自 if 判断，将来加第三个消费者（比如「监听所有群做索引」）就会互相踩。需要的是**一个 `EventRouter`**：注册的处理器按 priority 排序，命中后可选 block。约 150 行。 |
| `got/receive/pause/reject` 的多轮会话 | **能借，但只借「显式会话表」这一半** | qchat-cli 现在是 Map + 定时器，没有「过期清理」「多轮中超时回复」的统一出口。照搬 Python 的异常控制流没必要。 |
| Dependent 依赖注入 | **不借** | TS 里要给处理函数注入参数，代价是维护一套参数解析器 + 类型体操；qchat-cli 的处理函数要么是 CLI action、要么是 `GroupToolRunner` 的方法，注入收益接近 0。 |
| PluginManager 的 import hook | **不借（换语言了）** | Python 的 `sys.meta_path` 在 Node 里没有对等物；Node 侧应对应是动态 `import()` + 不缓存，见 Koishi 一节。 |
| PluginMetadata（名称/描述/用法/配置 schema/supported_adapters） | **能借，且几乎零成本** | qchat-cli 的插件目录要能被 `qce tools list` 列出来、被 MCP 暴露，就必须有这份元数据。见第 6 节插件方案。 |

### 借过来要改哪里
- 新增 `src/core/event-router.ts`：`register({ name, match(event), priority, block, handle })`，`dispatch(event)` 串行执行、命中 block 即停。`group-bot.ts:130`、`private-bot.ts:190`、`ws-monitor.ts:76` 改成向 router 注册。
- 新增 `src/core/session-store.ts`：把 `group-bot.ts:92` 的 `awaitingFollowUp` 提出来，支持 `set(key, ttl)` / `take(key)` / 定时清理 / 过期回调（过期时由调用方决定是否回复「等太久了」）。
- `reply-gate.ts` 不动——它已经是 rule+permission 的等价物，改造它反而是负收益。

---

## 2. Koishi（TypeScript）

**读了**：`packages/core/src/context.ts`、`packages/core/src/middleware.ts`（Processor、`ctx.middleware`、`ctx.match`、`Next.MAX_DEPTH=64`）、`packages/core/src/permission.ts`（Permissions.define/provide/inherit/depend/test）、`packages/loader/src/shared.ts`（`reload/unload`、`kRecord`、`writeConfig` 原子写、`$filter`/`$if` 元字段、`fullReload` 走 `process.exit(51)` + 环境变量传递）。

### 它的核心抽象
- **Context + Service**：服务通过 `ctx.provide('name', impl, true)` 注册，插件通过 `ctx.plugin(plugin, config)` 挂到某个 fork scope 上；scope 有生命周期（`dispose` 可撤销它注册的一切）。
- **中间件洋葱**（Koa 风格）：`(session, next) => ...`，`Next.MAX_DEPTH = 64` 有爆栈保护，`middleware()` 返回 dispose 函数。
- **Loader**：配置文件（json/yaml/js）里的 `plugins` 段按 key 实例化插件；`reload` 时**有 fork 就 `fork.update(config)`，没有就新建**；`unload` 即 `fork.dispose()`；`~` 前缀 = 停用；写盘用 `.tmp` + `rename` 原子替换；实在无法局部热更时 `fullReload()` 直接退出进程（退出码 51，由外层守护重启）。

### 它解决什么问题
「一个长期运行的 bot 里，几十个插件互相依赖服务、开关、换配置，都要不重启进程」。

### qchat-cli 现在怎么做
- 常驻自动化的「热更新」是**进程级**的：`src/commands/automation.ts` 用 PowerShell 按命令行匹配 `RESIDENTS`（`qq-watch.mjs`、`qq-watchdog.mjs`、`qq-poke-watch.mjs`、`diary-scheduler.mjs`、`qce-auto.mjs`）来停/起。
- 配置读取：`src/config/index.ts` 用 `conf`，每次 `get` 读内存里的 store；`group-agent.ts:36` 的 `loadGroupBotModelConfig()` 是**启动时读一次 json**，改了配置必须重启。
- 全 `src/` 里**没有任何 `fs.watch`/`chokidar`**（已 grep 确认），所以「配置热更新」目前不存在。

### 能不能借
| 项 | 判断 | 理由 |
|---|---|---|
| 中间件洋葱 | **借一半**：借「链式处理 + 单点限流/去重」的位置，不借「一切都中间件」 | qchat-cli 缺的不是抽象，是**一个所有出站消息都必须经过的关卡**。见第 6 节 P0-1。 |
| Permissions 的 `define/provide/inherit/depend` | **不借** | 这是给「插件声明自己需要什么权限、平台给出什么权限」设计的，qchat-cli 的权限只有两层（`owner` / `guest`，见 `src/core/owner.ts`），用不到权限图。 |
| Loader 的 `reload/unload` + dispose 语义 | **借「unload 必须能撤回注册」这一条** | qchat-cli 的插件目录如果只能加载不能卸载，热加载就是半成品。要求插件 `export default (ctx) => ctx.dispose 回调`。 |
| 配置文件原子写（`.tmp` + `rename`） | **能借，小改动** | qchat-cli 的 `saveOwnerConfig()`（`owner.ts:42`）是 `writeFileSync` 直接覆盖；进程被 kill 在写一半时会得到半截 json，`loadOwnerConfig()` 的 catch 会**静默回落到默认主人 `1473517806`**——这是个真实的降权/降智风险。 |
| `fullReload` 用退出码 + 外层守护重启 | **能借，且 qchat-cli 已有半套** | `automation.ts` 的 watchdog 已经在做重启；只需约定「需要整体重启」时 `process.exit(51)` 并让 `.launch-watchdog.cmd` 识别它。是否值得，取决于第 5 节插件方案做到哪一步。 |
| 整个 Koishi 式 DI 容器 | **不借** | 见下。 |

### 为什么不重写 / 不换框架
- **硬理由？没有。** qchat-cli 的核心价值在 `search-index.ts`（中文二元组检索）、`emoji-library.ts`、`hex-*`、`mcp-server.ts`、`dispatch.mjs` 这些**业务逻辑**上，与框架无关；换 Koishi 等于把这些全部用 Koishi 的 Session/Command API 重写一遍，**没有一行能直接复用**。
- **迁移成本（估）**：16 个 MCP 工具 + 36 个测试 + 派活车道 + 5 个常驻脚本都要重接；按当前代码量，属于「2~3 周全职 + 长期 bug 期」，而收益只是「插件作者体验」——qchat-cli 没有外部插件作者。
- **唯一让我犹豫的点**：Koishi 的 `Session` 已经统一了「平台 + 场景 + 权限 + 引用消息」，如果将来要接第二个平台，这层抽象是省事的。但这正好是第 4 节「多平台」要单独算账的事。

### 借过来要改哪里
- `src/core/group-agent.ts:36` `loadGroupBotModelConfig()` → 改成可重入 + 带 mtime 缓存（见第 6 节 P1-2）。
- `src/core/owner.ts:42` `saveOwnerConfig()` → 原子写。
- 新增 `src/core/plugin-host.ts`（见第 6 节 P2-1），要求插件返回 dispose。

---

## 3. 云崽 Yunzai（Node）

**说明**：原仓库 `Le-niao/Yunzai-Bot` 的 GitHub API 返回 `Repository access blocked (tos)`，**拿不到原版源码**。这里读的是社区维护分支 `yoimiya-kokomi/Miao-Yunzai` 的 `lib/plugins/loader.js`、`lib/plugins/plugin.js`——**它是 fork，行为可能与原版有差异（待验证）**。

### 它的核心抽象
- **插件基类**：`class XxPlugin extends plugin { constructor(){ super({name, dsc, handler, event, priority, task, rule}) } }`，`rule[i]` 声明 `{ reg, fnc, event, log, permission }`。
- **单一事件分发函数 `deal(e)`**（`loader.js` 中部）：检查频道 → **冷却 `checkLimit`** → 消息字段归一化 `dealMsg` → **黑白名单 `checkBlack`** → 包装 `e.reply` → 按 `priority` 排序逐插件跑 `accept` → 再按 `rule.reg` 正则匹配 → **`filtPermission`（master/owner/admin/all）** → 执行、异常就地 log。
- **热更新**：`chokidar` 监听 `plugins/<dir>/<file>.js`，`change` 时 `import(...?${timestamp})` 绕开 ESM 缓存，`unlink` 时移除。

### 它解决什么问题
「开箱即用的一堆娱乐功能」——所以它的重点是**防滥用**：谁都能拉机器人说话，必须有一层层闸门（冷却、黑白名单、按群禁用、按人限权）。

### qchat-cli 现在怎么做
- 冷却：只有 `tools.ts:107` 的 `RATE_FILE` + `MAX_PER_MINUTE = 10`（按分钟计数，文件持久化），**且只在「像人一样发消息」那条路径上**。
- 黑白名单：只有 `safety.ts` 的 `allowedSessions: number[]` —— 一个**扁平数组，群号和 QQ 号混在一起**，没有「这个群允许、但这个人不允许」的维度。
- 按群禁用某功能：**没有**。
- master/owner/admin：`owner.ts` 只有 `owner` / `guest` 两级，**没有群主/管理员这一级**。

### 能不能借
| 项 | 判断 | 理由 |
|---|---|---|
| `deal(e)` 那五道闸门的**顺序**（冷却 → 黑白名单 → 归一化 → 权限 → 执行） | **强烈建议借顺序** | 现在 qchat-cli 的冷却在很靠后的发送点上，等于「先跑模型、再发现该限流」。顺序反了会白花钱（群机器人一次回复要调 LLM + 可能是 vision）。 |
| 插件级冷却 + 按群禁用 | **能借** | 见 P1-1。 |
| `permission: master/owner/admin/all` | **能借（补一档）** | qchat-cli 缺「群管理员」这一档；现在只能靠 owner 一个人。注意：`group_member` 事件里本来就有 `role`（`onebot-client.ts:45`），数据是现成的。 |
| chokidar 热更新 | **借思路，不照搬** | `import(...?timestamp)` 在 ESM 下确实能绕缓存，但**每次热更都会泄漏旧模块的闭包**（定时器、WS 订阅不会被回收）——云崽自己也只在 `change` 时这么干，没做 dispose。qchat-cli 有常驻 WS 订阅，照搬会泄漏，必须要求 dispose（Koishi 那节的做法）。 |

### 借过来要改哪里
- `src/core/safety.ts`：`allowedSessions: number[]` → 拆成 `groups: number[]` / `users: number[]`，并新增 `blockedUsers: number[]`。**这是一次破坏性配置变更**，要做迁移（读旧字段自动分流：`>10^8` 视为群？不对，QQ 号也可能很长——**必须按「该 id 是否在 `getGroupList()` 里」判断**，一次性落盘新结构）。
- 新增 `src/core/rate-limit.ts`：把 `tools.ts:107-140` 的限速抽出来，key 从「全局」变成 `(sessionId)` 和 `(sessionId, feature)`；并让**所有出站路径**（`qce say`、MCP `send_message`、群机器人回复、proactive）都过它。
- `src/core/owner.ts`：`Authority` 增加 `'admin'`。

---

## 4. OneBots / imhelper（多平台网关）

**读了**：`packages/core/src/types.ts`（`CommonEvent` / `CommonTypes.Id` / `CommonAction`）、`packages/core/src/ordered-event-delivery-queue.ts`（有序投递队列）、`packages/core/src/index.ts`（模块清单，含 `recent-event-deduplicator`、`reliable-event-ingress`、`adapter-capability`、`rate-limiter`、`circuit-breaker`）、`packages/core/ARCHITECTURE.md`。README 里的「15+ 平台、Satori/Milky 双协议」属宣传，**未验证**。

### 它的核心抽象
- **CommonEvent**：把各平台事件归一成 `Message | Notice | Request | Meta`，且 `Id` 是三形态 `{string, number, source}`（因为有的平台 id 不是数字）；**保留 `raw_event`**，标准投影不全时仍能无损取平台字段。
- **OrderedEventDeliveryQueue**：事件按入队顺序串行投递，失败按 `[1s,2s,5s,10s,30s]` 退避重试，`onBacklog` 积压告警，`stop()` 中止当前代次且**明确告知调用方「没投递成功，别 ACK 上游」**。

### 它解决什么问题
「同一个进程里接多个平台，业务代码只写一遍」；以及「事件源没有背压（Webhook/WS 推过来就不管了），业务侧要保证不丢、不乱序」。

### qchat-cli 现在怎么做
- **只在 QQ**，`OneBotEvent` 是个大 `any` 联合（`onebot-client.ts:139-167`），并且**判定按消息段类型 `('at' in segments)`**（`group-bot.ts:136`）。
- 事件处理是**同步回调**：`onebot-client.ts` 的 `handleMessage` 里直接 `for (handler of eventHandlers[type]) handler(data)`（第 895 行附近）——**没有队列、没有重试、没有积压观测**。处理慢就会堵 WS 读循环。这是个真实风险：群机器人的一次回复要调 LLM（默认 45s 超时，`group-agent.ts:13`）。
- 去重：没有。OneBot 侧 NapCat 偶尔会重推（断线重连后），`message_id` 去重是个 10 行的事。

### 能不能借
| 项 | 判断 | 理由 |
|---|---|---|
| OrderedEventDeliveryQueue | **强推**（P0-2） | 直接把 `onebot-client.ts` 的同步回调改成「入队 → 串行投递 → 退避重试」。**这是当前最实质的性能/稳定性改进**，而且可以原样照抄设计（约 120 行 TS）。 |
| `recent-event-deduplicator` | **强推** | 用 `message_id + group_id` 做 LRU 去重，20 行。 |
| CommonEvent 三形态 Id | **不借（现在）** | qchat-cli 只有 QQ，id 都是 number。但 **`safety.ts` 的 `number[]` 已经是这个问题的苗头**：如果哪天要接「频道 tiny_id（string）」，白名单会静默失效。建议现在就把白名单 key 定义成 `(kind, id)` 结构化，而不是裸 number——**成本几乎为 0，收益是避免一次静默越权**。 |
| 保留 `raw_event` | **已满足** | qchat-cli 的 `OneBotEvent` 联合末尾有 `| any`，`raw_message` 也保留了。 |
| 多平台 adapter 层 | **不借，见第 5 节** | |

### 借过来要改哪里
- 新增 `src/core/event-queue.ts`（抄设计，不抄实现）：`enqueue(event)` 返回 `Promise<boolean>`，`dispatch` 用注入的 handler 链。
- `src/core/onebot-client.ts:888-895`（`handleMessage`）：同步 `handler(data)` → `queue.enqueue(data)`，并加 `onBacklog` 日志。
- `src/core/onebot-client.ts` 增加 `seen: Set<number>` LRU 去重（`message_id`），命中直接 return。

---

## 5. NapCat 自身的协议端能力

**读了**：本地 `_napcat-v2/napcat.mjs`（3.3MB 打包产物）里出现的 action 名字符串。这是**扫码清单，不是文档**——参数细节全部待验证。

### 它的核心抽象
OneBot 11 协议的一个「超集实现」：除了标准 v11 action，还带大量 `_qzone_*`、`*_custom_face`、`get_group_honor_info` 之类的扩展 action。

### 统计（可复核）
- `napcat.mjs` 里能抓到 **159 个**形如 `"get_*/set_*/send_*/delete_*/upload_*/create_*/mark_*/fetch_*/nc_*"` 的 action 名。
- qchat-cli 的 `onebot-client.ts` 封装了约 **68 个**方法，实际调用到的 action 约 **29 个**（`grep "request('…')"` 统计，含 `_get_group_notice`、`_send_group_notice` 这类下划线开头的是 NapCat 扩展）。

### 差距里**真正值得补**的（按 nvidia 那种「有就给方案」的标准）
| NapCat action | qchat-cli 现状 | 值不值得补 | 用途 |
|---|---|---|---|
| `set_msg_emoji_like` | 无 | **值得** | 群里「贴表情回应」比发一条消息轻得多，是「像人」的成本最低手段。 |
| `fetch_emoji_like` / `get_emoji_likes` | 无 | **可以** | 看自己发的消息被谁贴了表情 → 表情库的正反馈信号（`sticker-feedback.ts` 已有骨架，缺数据源）。 |
| `get_forward_msg` | 无 | **值得** | 合并转发的聊天记录目前读到的是空/占位，日报和索引会漏内容。 |
| `get_recent_contact` | 无 | 可以 | 判断「这个会话最近有没有人说话」，比拉历史便宜。 |
| `get_online_clients` | 无 | 低 | 诊断「是不是手机也在线导致消息不同步」。 |
| `set_input_status`（输入中） | 无 | **谨慎** | 能显著「像人」，但属于**伪装类**能力，和 `tools.ts:104` 里「不是为了骗过风控」的既定立场冲突。**建议不补**。 |
| `send_forward_msg` / `upload_forward_msg` | 无 | 可以 | 日报较长时用合并转发，避免刷屏。 |
| `get_group_shut_list` | 无 | 低 | —— |

> 注：`napcat.mjs` 里还有 `send_packet`、`set_restart`、`get_cookies`、`get_csrf_token` 这类**高危/账号自毁**能力，**明确不建议封装**。

---

## 6. 五个重点问题的正面回答

### 6.1 插件/扩展机制：能否做成可热加载的插件目录？
**现状**：`src/cli.ts` 是 41 行 import + 41 行 `xxCommand(program)` 的硬编码（第 13-53、71-111 行）。新增一个子命令要改 3 处。MCP 工具更硬：`mcp-server.ts:115` 的 `TOOLS` 是字面量数组，`switch (name)` 在 `callTool` 里（约 380-843 行），**每加一个工具要改 2 处 + 改 `McpBackend` 接口**。

**能借**：能，但**分两步**，不要一步到位做 Koishi 式的 effect scope。

- **第 1 步（小，低风险）——命令注册表化**：新增 `src/plugins/registry.ts`，`qce` 启动时 `readdir('plugins/')` 动态 import，每项导出 `{ name, description, register(program), mcp?: McpToolDef }`。`cli.ts` 缩成 10 行。**这一步不要求热加载**，只是把「硬编码」换成「目录扫描」，行为完全不变。
- **第 2 步（中，中风险）——加载/卸载**：插件 `export default (ctx: PluginCtx) => void | (() => void)`，返回 dispose。宿主维护 `Map<name, dispose>`，`qce plugin reload <name>` = `dispose()` 后重新 import（带 `?t=` 破缓存）。
- **MCP 工具也走同一张表**：`TOOLS` 从注册表拼出来，`callTool` 的 `switch` 换成 `Map<name, handler>`。这一步会**顺手解决**「16 个工具靠 switch 手写校验」的重复劳动。
- **风险**：热加载时**旧模块的定时器/WS 订阅不会自动回收**（云崽就是这么漏的）。所以：能返回 dispose 的才允许热更，不返回的只允许重启。另外 `src/core/*.ts` 里的单例（`authManager`、`safetyManager`、`configManager`）会**被插件缓存住旧引用**——必须让插件通过 `ctx` 拿服务，不许 `import { safetyManager }`。

**结论**：值得做，但**排在 P2**。它不解决当前的任何故障，只省未来的重复劳动。

### 6.2 事件分发模型：轮询 + 手工投递 vs 事件总线/中间件，差在哪？
**qchat-cli 其实已经不用轮询了**（`ws-monitor` / `group-bot` / `private-bot` 都走 WS；`monitor.ts` 的 `startPolling` 是遗留的演示路径，它的 `generateReply()` 还是「你好/hi/问号」的模板——`monitor.ts:12-28`，**这是个明显该删或有标注的遗留物**）。

真差距有三条：
1. **没有队列**：慢处理器堵读循环（见 4 节 OrderedEventDeliveryQueue）。
2. **没有优先级/拦截**：`on()` 注册的 handler 是平铺的 `Array`，谁先注册谁先跑，没人能「拦下这条，后面的别跑」。
3. **没有去重**：见 4 节。

**能借**：事件队列（P0-2）+ EventRouter 的 priority/block（P1-3）。**不需要引入 RxJS/EventEmitter3 之类**——Node 内置的机制 + 一个 150 行的 router 足够。

### 6.3 权限与指令系统：safety 白名单够不够？
**不够，但缺的不是「更复杂的权限模型」，是「更粗的闸门 + 更细的粒度」各缺一样。**

| 缺什么 | 证据 | 补法 |
|---|---|---|
| 出站路径没统一闸门 | `safety.ts` 的 `isAllowed` 只在 `commands/mcp.ts:63` 和 `group-bot.ts:66` 被调用；`tools.ts` 的 `qce say` 直接 `sendSegments()`（`tools.ts:73-79`），**没调 `safetyManager`**（grep 确认 `tools.ts` 不 import safety） | 做出站消息的唯一出口 `sendGuarded()`，所有路径必须过它 |
| 白名单是扁平 number 数组 | `safety.ts:10` `allowedSessions: number[]` | 结构化 `{groups, users, blocked}` + 迁移 |
| 没有「人」的维度 | 群里任何人都能触发；只有 `owner.ts` 区分主人 | `Authority: owner/admin/guest`，admin 来自 `getGroupMemberList` 的 `role` |
| 没有确认令牌的跨进程一致性 | `mcp-server.ts:80-93` 的 `pending/pendingStickers/pendingHex` 是**内存 Map**，「进程退出即失效」是写在注释里的设计 | 这是**可接受**的（MCP 客户端本来就是长连接），不必改；但如果哪天 MCP server 改成「每次调用起一个进程」，二次确认就会永远失败——**这点要写进文档**（待验证：当前 `qce mcp` 是不是常驻 stdio 进程？从 `commands/mcp.ts` 看是 `runStdioServer`，应当是常驻） |

**结论**：白名单方向对（默认拒绝、空白名单=拒绝，`safety.ts:53-55` 这条做得比很多同类项目好），但**覆盖面**不够——这是 P0。

### 6.4 多平台抽象：值得抽一层吗？
**现在不值得。**
- 理由：qchat-cli 的绝大部分代码是「QQ 特有」的：`qzone-client.ts`、`get_custom_face_detail`（表情库）、`hex-*`（跟平台无关但跟业务强绑）、`dispatch.mjs`（跟 DSH 绑）。真正与平台无关的只有 `search-index.ts`、`digest.ts`、`memory.ts` 这些**纯函数**，它们**本来就没被平台污染**。
- 抽层的真实成本：`OneBotEvent` 联合 + `MessageSegment` 类型会变成 `PlatformEvent` + 各平台 adapter 的映射表；`onebot-client.ts` 的 68 个方法里，能进公共抽象的不到 10 个（发文本/发图/拉历史/列表）。
- **唯一建议做的前置动作**：把 `safety.ts` 的 key 从 `number` 改成 `(platform, kind, id)` 结构化（成本≈0），这样将来真要接第二个平台时，权限层不用推倒。
- **什么时候再考虑**：出现「同一个业务要同时在 QQ 和另一个平台跑」的真实需求时。那时可以直接**用 OneBots 当网关**（它已经把 OneBot v11 暴露出来，`qchat-cli` 只需继续对着 OneBot 说话），**比自研抽象层便宜得多**——这是 OneBots 对我们最有价值的地方，不是它的代码，是它的定位。

### 6.5 配置校验与热更新：别人怎么做的？
| 项目 | 做法 | qchat-cli 现状 | 借不借 |
|---|---|---|---|
| NoneBot | 插件声明 `config: Type[BaseModel]`（pydantic），启动时统一校验，失败即拒绝加载该插件 | `group-agent.ts:36-73` 是一段手写 `Number(...)` + `Math.min/max` 的钳位，**校验和默认值混在一起** | **借思路**：抽出 `validateGroupBotConfig(raw)` 纯函数（可单测），返回 `{value, warnings}`；现在钳位是静默的（`historyMessages` 传 500 会被悄悄改成 100），至少该 warn |
| Koishi | `Schema.object` / `Config.list`，配置由 schema 生成 UI 与默认值；写盘原子 | `conf` 库，无 schema | 借「原子写」这一条（见 owner.ts） |
| OneBots | `config-validator.ts` 的 `validateWithDefaults`，运行期校验 + 原子持久化 + 热更新边界 | 无 | 借「热更新边界」的表述：明确哪些配置**能热更**（模型名、阈值、冷却）、哪些**必须重启**（baseUrl/端口/WS 地址） |
| Miao-Yunzai | 无 schema，靠 `cfg.getGroup()` 现场取，缺字段用 `?.` 兜 | 类似 | 不用借 |

**落地**：`loadGroupBotModelConfig()` 改成 `{ read(mtime 缓存), validate, warnings }`，并在 `group-bot.ts` 每处理 N 条消息时检查一次文件 mtime，变了就重读——**这就是最便宜的「热更新」**，不需要 chokidar，也不需要 Koishi 的 effect scope。

---

## 7. 按性价比排序的改进清单

> 排序依据：`(解决的真实问题严重度 × 确定性) / 工作量`。**风险**栏写的是「改了会不会把现在能跑的东西改坏」。

| # | 改进 | 工作量 | 风险 | 解决什么 | 改哪里 |
|---|---|---|---|---|---|
| P0-1 | **出站消息统一闸门**：所有发消息路径（`qce say`、MCP `send_message`/`send_image`/`send_poke`、群机器人回复、proactive）都过 `sendGuarded(target, segments)`：白名单 + 频控 + 审计一次做全 | 小（半天） | 低。唯一风险是 `tools.ts` 的现有调用会开始受白名单约束**可能被拒**——先在 `sendGuarded` 里对「CLI 本地调用」默认放行并打 audit，跑一周再收紧 | 目前 `qce say` 完全绕过 safety（已 grep 确认），等于白名单可以一键绕过 | 新增 `src/core/send-guard.ts`；改 `src/commands/tools.ts:73`、`src/commands/mcp.ts:61`、`src/core/proactive.ts` 的发送点 |
| P0-2 | **WebSocket 事件队列 + 去重**：入队 → 串行投递 → 退避重试 → `message_id` LRU 去重 → 积压告警 | 小~中（1 天） | 中。改的是所有 WS 消费者的入口，**要保证「同一个事件的 handler 顺序不变」**，否则 `group-context` 的顺序会乱 | 群机器人一次回复 45s 超时，同步回调会堵 WS 读循环；断线重连后可能重复处理同一条消息 | 新增 `src/core/event-queue.ts`；改 `src/core/onebot-client.ts` 的 `handleMessage` |
| P0-3 | **safety 白名单结构化**：`{groups, users, blocked}` + 迁移旧 `allowedSessions` | 小（半天） | **中高**。破坏性配置变更；迁移判断「这是群号还是 QQ 号」要靠 `getGroupList()` 交叉验证，离线时无法迁移——**必须先在线跑一次** | 群号和 QQ 号混在一个数组里，将来加 `blockedUsers` 就没法区分 | `src/core/safety.ts`、`src/commands/setup.ts`、`src/commands/admin.ts` |
| P1-1 | **限速抽出 + 按会话**：`tools.ts` 的 `MAX_PER_MINUTE` 从全局改成 `(sessionId)`，并加每功能冷却（群机器人回复、proactive、表情 各算各的） | 小（半天） | 低 | 现在一个会话刷屏会拖慢所有会话；proactive 有每日上限但没有分钟级冷却 | 新增 `src/core/rate-limit.ts`；改 `src/commands/tools.ts:107-140`、`src/core/proactive.ts` |
| P1-2 | **配置校验 + mtime 热读**：`validateGroupBotConfig()` 纯函数 + 文件 mtime 变化即重读 + 静默钳位改 warn | 小（半天） | 低 | 改配置必须重启；钳位静默吞掉用户的错值 | `src/core/group-agent.ts:36-73`（抽出）、`src/commands/group-bot.ts`（加 mtime 检查） |
| P1-3 | **EventRouter（priority + block）**：把 `group-bot` / `private-bot` / `ws-monitor` 的订阅改成注册 | 中（1~1.5 天） | 中。三个命令目前各自持有 client 与状态，要先抽一个共享的「WS 会话宿主」 | 加第三个消费者就会互相踩；现在 `block` 语义无处表达 | 新增 `src/core/event-router.ts`；改 `src/commands/group-bot.ts:130`、`private-bot.ts:190`、`ws-monitor.ts:76` |
| P1-4 | **owner.json 原子写** | 极小（20 分钟） | 极低 | 写一半被 kill → 静默回落默认主人 | `src/core/owner.ts:42` |
| P2-1 | **命令注册表化（不热加载）**：`plugins/` 目录扫描 + 每插件声明元数据；`cli.ts` 缩到 10 行 | 中（1~2 天） | 中。41 处 import 迁移，**任何一个漏了就是命令消失**，需要一条「旧命令集合 == 新命令集合」的测试兜底 | `cli.ts` 3 处改动/新命令；未来插件作者体验 | 新增 `src/plugins/registry.ts`；重写 `src/cli.ts` |
| P2-2 | **MCP 工具表化**：`TOOLS` 与 `callTool` 的 switch 统一成 `Map<name, {def, handler, validate}>` | 中（1.5~2 天） | 中。16 个工具的入参校验是手写的，迁移时要逐条对齐（不过**这正是它该有的测试**） | 每加一个工具改 2~3 处；校验逻辑重复 | `src/core/mcp-server.ts:115`（TOOLS）、`callTool`、`McpBackend` 接口 |
| P2-3 | **插件热加载（dispose 语义）** | 大（3~5 天） | **高**。单例被旧引用缓存、定时器泄漏，问题都很隐蔽 | 只在有外部插件作者时才有价值 | `src/core/plugin-host.ts` + 所有 `core/*` 单例改成 ctx 注入 |
| P2-4 | **会话续接表**：把 `awaitingFollowUp` 抽成带 TTL/过期回调的 store | 小（半天） | 低 | 现在是 Map + 一个常量，没有清理与过期回复 | 新增 `src/core/session-store.ts`；改 `group-bot.ts:92` |
| P2-5 | **补 NapCat 的三个 action**：`set_msg_emoji_like`、`get_forward_msg`、`fetch_emoji_like` | 小~中（每个 2~3 小时） | 低（只读/轻写）；`get_forward_msg` 的返回结构**待验证** | 表情反馈闭环缺数据源；合并转发内容读不到 | `src/core/onebot-client.ts` 加方法；`sticker-feedback.ts` 接数据 |
| —— | **多平台抽象层** | 大（5+ 天） | 高 | **不需要**。要接第二个平台时用 OneBots 当网关，别自研 | —— |
| —— | **重写为 Python / 换 Koishi** | 极大（2~3 周+） | 极高 | **没有硬理由**。业务逻辑与框架无关，重写等于零复用 | —— |

---

## 8. 我没有验证的部分（诚实标注）

1. **Yunzai 原版行为**：原仓库被 GitHub 以 ToS 封禁，读的是 Miao-Yunzai fork。云崽的「冷却/黑白名单」顺序在 fork 里是这样，原版是否一致——**待验证**。
2. **NapCat action 的参数与返回**：只从 `napcat.mjs` 抓到了 action 名字，**没有实际调用**。`get_forward_msg` 返回什么结构、`fetch_emoji_like` 能不能用在别人的消息上——**待验证**。
3. **OneBots 的 README 宣传**（15+ 平台、Satori/Milky 双协议）：只读了 `CommonEvent` 类型与队列源码，adapter 是否真有那么多且可用——**未验证**。
4. **`qce mcp` 是否常驻**：从 `commands/mcp.ts` 的 `runStdioServer` 推断是常驻 stdio 进程，但没跑起来实测；如果它是「每次调用起一个进程」，`mcp-server.ts` 的内存态确认令牌会永远失效——**待验证（重要）**。
5. **`tools.ts` 是否真的绕过 safety**：是靠 grep「`tools.ts` 里没有 `safety`」判断的，没有运行验证。**这条是 P0-1 的全部依据，建议动手前先跑一次 `qce say` 到未授权会话来确认。**
