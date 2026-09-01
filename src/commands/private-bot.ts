import { Command } from 'commander';
import chalk from 'chalk';
import { authManager } from '../core/auth.js';
import { generatePrivateReply, loadGroupBotModelConfig, summarizePrivateMemory, type GroupBotModelConfig } from '../core/group-agent.js';
import { safetyManager } from '../core/safety.js';
import { MessageSegment, OneBotEvent } from '../core/onebot-client.js';
import { PrivateContextStore, privateContextPath, sharedPrivateContextPath } from '../core/private-context.js';
import { PrivateMemoryStore, SharedPrivateMemoryStore } from '../core/private-memory.js';
import { PRIVATE_AGENT_TOOLS, PrivateToolRunner } from '../core/private-tools.js';
import { syncEmojiLibrary } from '../core/emoji-library.js';
import { loadRelevantSkills } from '../core/group-skills.js';
import { PrivateMcpRegistry } from '../core/private-mcp.js';

const CURRENT_INFO_PATTERN = /(最近|最新|今天|今日|新闻|事件|动态|进展|传闻|消息|评价)/;
const SENSITIVE_QUERY_PATTERN = /(密码|密钥|token|api[_ -]?key|身份证|手机号|电话|住址)/i;

function hasPromptPayload(segments: MessageSegment[]): boolean {
  return segments.some((segment) => {
    if (segment.type === 'text' && 'text' in segment.data) return !!segment.data.text.trim();
    return ['image', 'face', 'video', 'voice', 'record', 'file'].includes(segment.type);
  });
}

function parseUserId(value: string): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function shouldPrefetchPublicSearch(question: string): boolean {
  return CURRENT_INFO_PATTERN.test(question) && !SENSITIVE_QUERY_PATTERN.test(question) && question.length <= 180;
}

function compactSearchResult(result: string): string {
  if (!result || /Tool request failed|Public search is unavailable/.test(result)) return '';
  return result
    .replace(/[{}\[\]"]/g, ' ')
    .replace(/\b(?:url|text)\s*:/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 800);
}

type AgentMode = 'single' | 'split';

interface MemoryRecord {
  summary: string;
}

interface MemoryStore {
  load(): MemoryRecord;
  save(summary: string): MemoryRecord;
}

interface AgentState {
  contextStore: PrivateContextStore;
  memoryStore: MemoryStore;
  memory: MemoryRecord;
  replyQueue: Promise<void>;
  memoryQueue: Promise<void>;
  lastMessageAt: number;
  memoryTimer: NodeJS.Timeout | null;
  status: 'idle' | 'replying' | 'compacting';
  completedTurns: number;
  failedTurns: number;
  lastCompletedAt: number;
}

export function privateBotCommand(program: Command): void {
  const privateBot = program
    .command('private-bot')
    .description('私聊机器人：可由单一 Agent 或独立 Agent 响应指定 QQ 号');

  privateBot
    .command('start <userIds...>')
    .description('启动指定私聊的自动回复机器人')
    .option('--mode <mode>', 'single（默认，共享 Agent）或 split（每人独立 Agent）', 'single')
    .action(async (userIdValues: string[], options: { mode: string }) => {
      const userIds = [...new Set(userIdValues.map(parseUserId))];
      if (userIds.some((id) => id === null)) {
        console.log(chalk.red('所有 QQ 号都必须是正整数'));
        return;
      }
      const targetUserIds = userIds as number[];
      const mode = options.mode === 'single' || options.mode === 'split' ? options.mode as AgentMode : null;
      if (!mode) {
        console.log(chalk.red('模式必须是 single 或 split'));
        return;
      }
      if (!authManager.isConfigured()) {
        console.log(chalk.red('请先配置 OneBot 连接: qce login'));
        return;
      }
      const unauthorized = targetUserIds.filter((userId) => !safetyManager.isAllowed(userId));
      if (unauthorized.length) {
        console.log(chalk.red(`以下 QQ 未获发送授权：${unauthorized.join(', ')}`));
        console.log(chalk.dim(`先运行: qce safety enable; qce safety allow <QQ号>`));
        return;
      }

      let modelConfig: GroupBotModelConfig;
      try {
        modelConfig = loadGroupBotModelConfig();
      } catch (error) {
        console.log(chalk.red(error instanceof Error ? error.message : String(error)));
        return;
      }

      const client = authManager.getClient();
      const mcpRegistry = new PrivateMcpRegistry(modelConfig.mcpServers);
      let mcpTools: ReadonlyArray<unknown> = [];
      let emojiSyncActive = false;
      const states = new Map<string, AgentState>();
      const stateKey = (userId: number) => mode === 'single' ? 'shared' : String(userId);
      const getState = (userId: number): AgentState => {
        const key = stateKey(userId);
        const existing = states.get(key);
        if (existing) return existing;
        const memoryStore: MemoryStore = mode === 'single' ? new SharedPrivateMemoryStore() : new PrivateMemoryStore(userId);
        const state: AgentState = {
          contextStore: new PrivateContextStore(mode === 'single' ? sharedPrivateContextPath() : privateContextPath(userId)),
          memoryStore,
          memory: memoryStore.load(),
          replyQueue: Promise.resolve(),
          memoryQueue: Promise.resolve(),
          lastMessageAt: 0,
          memoryTimer: null,
          status: 'idle',
          completedTurns: 0,
          failedTurns: 0,
          lastCompletedAt: 0,
        };
        states.set(key, state);
        return state;
      };
      for (const userId of targetUserIds) getState(userId);

      const scheduleMemoryMaintenance = (userId: number, state: AgentState) => {
        const needsCompaction = mode === 'single'
          ? state.contextStore.needsSharedCompaction(modelConfig.memoryCompactAfterMessages)
          : state.contextStore.needsCompaction(userId, modelConfig.memoryCompactAfterMessages);
        if (!needsCompaction) return;
        if (state.memoryTimer) clearTimeout(state.memoryTimer);
        state.memoryTimer = setTimeout(() => {
          if (Date.now() - state.lastMessageAt < 60_000) {
            scheduleMemoryMaintenance(userId, state);
            return;
          }
          state.memoryQueue = state.memoryQueue.then(async () => {
            state.status = 'compacting';
            const pending = mode === 'single'
              ? state.contextStore.buildSharedCompactionInput()
              : state.contextStore.buildCompactionInput(userId);
            if (!pending.count) return;
            const summary = await summarizePrivateMemory(state.memory.summary, pending.content, modelConfig);
            state.memory = state.memoryStore.save(summary);
            if (mode === 'single') state.contextStore.markSharedCompacted(pending.count);
            else state.contextStore.markCompacted(userId, pending.count);
            state.status = 'idle';
            console.log(chalk.dim('私聊记忆已在后台更新'));
          }).catch((error) => {
            state.status = 'idle';
            console.log(chalk.yellow(`后台私聊记忆更新失败: ${error instanceof Error ? error.message : String(error)}`));
          });
        }, 60_000);
      };
      const syncEmojis = async () => {
        if (emojiSyncActive || !modelConfig.emojiSourceDirectory) return;
        emojiSyncActive = true;
        try {
          const result = await syncEmojiLibrary(modelConfig);
          if (result.added) console.log(chalk.dim(`表情库新增 ${result.added} 个，当前共 ${result.total} 个`));
        } catch (error) {
          console.log(chalk.yellow(`表情库同步失败: ${error instanceof Error ? error.message : String(error)}`));
        } finally {
          emojiSyncActive = false;
        }
      };

      await client.connect();
      mcpTools = await mcpRegistry.tools();
      const loginInfo = await client.getLoginInfo();
      console.log(chalk.green(`私聊机器人已启动：${mode === 'single' ? '单一 Agent（共享上下文）' : '分 Agent（隔离上下文）'}`));
      console.log(chalk.dim(`仅响应 QQ：${targetUserIds.join(', ')}。按 Ctrl+C 停止。`));
      console.log(chalk.dim(`每轮最多 ${modelConfig.maxToolCalls} 次工具调用、${modelConfig.maxToolRounds} 个工具回合，单次处理最长 ${Math.round(modelConfig.turnTimeoutMs / 1000)} 秒；MCP 工具 ${mcpTools.length} 个。`));
      console.log(chalk.dim(mode === 'single'
        ? '该模式会将这些私聊的近期上下文与摘要提供给同一个 Agent，并保存在 private/context/private-shared.json；仅在确实需要跨会话协作时使用。'
        : '每个 QQ 号拥有独立上下文与摘要，不会互相加载；近期原文和摘要分别存于 private/context/、private/memory/ 中对应 QQ 的文件。'));
      const emojiTimer = setInterval(() => { void syncEmojis(); }, 7 * 24 * 60 * 60_000);

      client.on('message_private', (event: OneBotEvent) => {
        if (event.post_type !== 'message' || event.message_type !== 'private') return;
        if (!targetUserIds.includes(event.user_id) || event.user_id === loginInfo.user_id) return;

        const userId = event.user_id;
        const state = getState(userId);
        const messageSegments = event.message as MessageSegment[];
        const recorded = state.contextStore.record(event);
        if (!recorded) return;
        state.lastMessageAt = Date.now();
        scheduleMemoryMaintenance(userId, state);
        let input = recorded.content;
        if (!input.trim() && hasPromptPayload(messageSegments)) input = '[对方发送了非文本消息]';
        if (!input.trim()) return;
        console.log(chalk.cyan(`[私聊 ${userId}] 收到消息，长度 ${input.length}，模式 ${mode}`));

        state.replyQueue = state.replyQueue.then(async () => {
          state.status = 'replying';
          try {
            const toolRunner = new PrivateToolRunner(client, userId, state.contextStore, modelConfig, mcpRegistry);
            toolRunner.beginTurn();
            const isCurrentInfoRequest = shouldPrefetchPublicSearch(input);
            const context = mode === 'single'
              ? state.contextStore.buildSharedAgentInput(modelConfig.historyMessages, modelConfig.maxInputChars)
              : state.contextStore.buildAgentInput(userId, modelConfig.historyMessages, modelConfig.maxInputChars);
            const skillContext = loadRelevantSkills(modelConfig.skillDirectory, input);
            const currentImage = state.contextStore.findImage(userId, event.message_id, 1);
            const imageStartedAt = Date.now();
            const imageDescription = currentImage
              ? await toolRunner.describeCurrentContextImage(event.message_id)
              : '';
            if (currentImage) console.log(chalk.dim(`当前图片预解析耗时 ${Date.now() - imageStartedAt}ms，结果长度 ${imageDescription.length}`));
            const searchStartedAt = Date.now();
            const rawSearchResult = isCurrentInfoRequest
              ? await toolRunner.run('web_search', { query: input })
              : '';
            const liveSearchResult = compactSearchResult(rawSearchResult);
            if (isCurrentInfoRequest) console.log(chalk.dim(`公开检索耗时 ${Date.now() - searchStartedAt}ms，结果长度 ${liveSearchResult.length}`));
            const replyStartedAt = Date.now();
            let reply: string;
            try {
              const tools = [...PRIVATE_AGENT_TOOLS, ...mcpTools];
              console.log(chalk.dim(`AI 请求：上下文 ${context.length} 字，记忆 ${state.memory.summary.length} 字，检索 ${liveSearchResult.length} 字，图片 ${imageDescription.length} 字，工具 ${tools.length} 个，思考模式 ${modelConfig.enableThinking ? '开' : '关'}`));
              reply = await generatePrivateReply(
                context, state.memory.summary, modelConfig, tools,
                (name, args) => toolRunner.run(name, args), liveSearchResult, imageDescription, skillContext, isCurrentInfoRequest, `QQ ${userId}`,
              );
            } catch (error) {
              if (!(error instanceof Error) || !/abort|timeout/i.test(error.message)) throw error;
              console.log(chalk.yellow('AI 首次请求超时，正在以同一上下文降级重试'));
              reply = await generatePrivateReply(
                context, state.memory.summary, modelConfig, [], async () => 'Tool disabled.', liveSearchResult, imageDescription, skillContext, true, `QQ ${userId}`,
              );
            }
            console.log(chalk.dim(`AI 回复耗时 ${Date.now() - replyStartedAt}ms`));
            if (!reply || !safetyManager.isAllowed(userId)) return;
            const sent = await client.sendPrivateMessage(userId, reply);
            state.contextStore.recordOutgoing(userId, sent.message_id, reply);
            state.completedTurns += 1;
            state.lastCompletedAt = Date.now();
            console.log(chalk.green('已向授权私聊发送回复'));
          } catch (error) {
            state.failedTurns += 1;
            console.log(chalk.red(`AI 回复失败: ${error instanceof Error ? error.message : String(error)}`));
          } finally {
            if (state.status === 'replying') state.status = 'idle';
          }
        });
      });

      process.on('SIGINT', () => {
        clearInterval(emojiTimer);
        for (const state of states.values()) if (state.memoryTimer) clearTimeout(state.memoryTimer);
        const completed = [...states.values()].reduce((total, state) => total + state.completedTurns, 0);
        const failed = [...states.values()].reduce((total, state) => total + state.failedTurns, 0);
        console.log(chalk.dim(`正在停止私聊 Agent：已完成 ${completed} 轮，失败 ${failed} 轮。`));
        void mcpRegistry.close();
        client.disconnect();
        process.exit(0);
      });
    });
}
