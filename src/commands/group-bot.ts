import { Command } from 'commander';
import chalk from 'chalk';
import { authManager } from '../core/auth.js';
import { generateGroupReply, getMentionedText, loadGroupBotModelConfig, summarizeGroupMemory, type GroupBotModelConfig } from '../core/group-agent.js';
import { safetyManager } from '../core/safety.js';
import { MessageSegment, OneBotEvent } from '../core/onebot-client.js';
import { GroupContextStore } from '../core/group-context.js';
import { GroupMemoryStore } from '../core/group-memory.js';
import { GROUP_AGENT_TOOLS, GroupToolRunner } from '../core/group-tools.js';
import { syncEmojiLibrary } from '../core/emoji-library.js';
import { loadRelevantSkills } from '../core/group-skills.js';

const CURRENT_INFO_PATTERN = /(最近|最新|今天|今日|新闻|事件|动态|进展|传闻|消息|评价)/;
const SENSITIVE_QUERY_PATTERN = /(密码|密钥|token|api[_ -]?key|身份证|手机号|电话|住址)/i;
const TEXT_AGENT_TOOLS = GROUP_AGENT_TOOLS.filter((tool) => tool.function.name !== 'group_image_describe');
const FOLLOW_UP_WINDOW_MS = 30_000;

function hasPromptPayload(segments: MessageSegment[]): boolean {
  return segments.some((segment) => {
    if (segment.type === 'text' && 'text' in segment.data) return !!segment.data.text.trim();
    return ['image', 'face', 'video', 'voice', 'record', 'file'].includes(segment.type);
  });
}

function parseGroupId(value: string): number | null {
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

export function groupBotCommand(program: Command): void {
  const groupBot = program
    .command('group-bot')
    .description('单群隔离机器人：仅响应目标群中 @ 机器人的消息');

  groupBot
    .command('start <groupId>')
    .description('启动指定群的隔离机器人')
    .option('--auto-reply', '调用 AI 回复被 @ 的消息')
    .action(async (groupIdValue, options) => {
      const groupId = parseGroupId(groupIdValue);
      if (!groupId) {
        console.log(chalk.red('群号必须是正整数'));
        return;
      }
      if (!authManager.isConfigured()) {
        console.log(chalk.red('请先配置 OneBot 连接: qce login'));
        return;
      }
      if (!safetyManager.isAllowed(groupId)) {
        console.log(chalk.red(`群 ${groupId} 未获发送授权`));
        console.log(chalk.dim(`先运行: qce safety enable; qce safety allow ${groupId}`));
        return;
      }

      let modelConfig: GroupBotModelConfig | null = null;
      if (options.autoReply) {
        try {
          modelConfig = loadGroupBotModelConfig();
        } catch (error) {
          console.log(chalk.red(error instanceof Error ? error.message : String(error)));
          return;
        }
      }

      const client = authManager.getClient();
      const contextStore = new GroupContextStore();
      const memoryStore = new GroupMemoryStore(groupId);
      let memory = memoryStore.load();
      const toolRunner = new GroupToolRunner(client, groupId, contextStore, modelConfig!);
      let replyQueue: Promise<void> = Promise.resolve();
      let memoryQueue: Promise<void> = Promise.resolve();
      let lastGroupMessageAt = 0;
      let memoryTimer: NodeJS.Timeout | null = null;
      let emojiSyncActive = false;
      const awaitingFollowUp = new Map<number, number>();
      const scheduleMemoryMaintenance = () => {
        if (!modelConfig || !contextStore.needsCompaction(groupId, modelConfig.memoryCompactAfterMessages)) return;
        if (memoryTimer) clearTimeout(memoryTimer);
        memoryTimer = setTimeout(() => {
          if (!modelConfig || Date.now() - lastGroupMessageAt < 60_000) {
            scheduleMemoryMaintenance();
            return;
          }
          memoryQueue = memoryQueue.then(async () => {
            if (!contextStore.needsCompaction(groupId, modelConfig!.memoryCompactAfterMessages)) return;
            const pending = contextStore.buildCompactionInput(groupId);
            const summary = await summarizeGroupMemory(memory.summary, pending.content, modelConfig!);
            memory = memoryStore.save(summary);
            contextStore.markCompacted(groupId, pending.count);
            console.log(chalk.dim('群记忆已在后台更新'));
          }).catch((error) => {
            console.log(chalk.yellow(`后台群记忆更新失败: ${error instanceof Error ? error.message : String(error)}`));
          });
        }, 60_000);
      };
      const syncEmojis = async () => {
        if (emojiSyncActive || !modelConfig?.emojiSourceDirectory) return;
        emojiSyncActive = true;
        try {
          const result = await syncEmojiLibrary(modelConfig);
          if (result.added) console.log(chalk.dim(`表情库新增 ${result.added} 个，当前共 ${result.total} 个`));
        } catch (error) {
          console.log(chalk.yellow(`表情库同步失败: ${error instanceof Error ? error.message : String(error)}`));
        } finally { emojiSyncActive = false; }
      };
      await client.connect();
      const loginInfo = await client.getLoginInfo();

      console.log(chalk.green(`隔离机器人已启动：仅群 ${groupId}`));
      console.log(chalk.dim('仅保存本群摘要；私聊、其他群、QQ 空间和聊天历史均不会被此命令读取。按 Ctrl+C 停止。'));
      const emojiTimer = setInterval(() => { void syncEmojis(); }, 7 * 24 * 60 * 60_000);

      client.on('message_group', (event: OneBotEvent) => {
        if (event.post_type !== 'message' || event.message_type !== 'group') return;
        if (event.group_id !== groupId || event.user_id === loginInfo.user_id) return;

        const segmentTypes = Array.isArray(event.message) ? (event.message as MessageSegment[]).map((segment) => segment.type) : [];
        const messageSegments = event.message as MessageSegment[];
        const containsMention = segmentTypes.includes('at');
        if (containsMention) console.log(chalk.dim(`[群 ${groupId}] 收到含 @ 的消息事件，消息段：${segmentTypes.join(',')}`));

        // The program, not the model, owns event collection and context assembly.
        const recorded = contextStore.record(event);
        if (!recorded) return;
        lastGroupMessageAt = Date.now();
        scheduleMemoryMaintenance();
        const mentionedInput = getMentionedText(event, loginInfo.user_id, loginInfo.nickname);
        let input = mentionedInput;
        if (mentionedInput === null) {
          const expiresAt = awaitingFollowUp.get(event.user_id) || 0;
          if (Date.now() > expiresAt) {
            awaitingFollowUp.delete(event.user_id);
          } else {
            awaitingFollowUp.delete(event.user_id);
            input = recorded.content || '[用户补充了一条非文本消息]';
            console.log(chalk.cyan(`[群 ${groupId}] 收到 @ 后的补充消息，长度 ${input.length}`));
          }
        }
        if (input === null) {
          if (containsMention) console.log(chalk.dim('该 @ 不指向机器人，已忽略。'));
          return;
        }
        if (!input.trim() && hasPromptPayload(messageSegments)) {
          input = recorded.content || '[用户发送了非文本消息]';
        }
        console.log(chalk.cyan(`[群 ${groupId}] 收到 @ 消息，长度 ${input.length}`));
        if (!options.autoReply || !modelConfig) return;
        if (!input.trim()) {
          awaitingFollowUp.set(event.user_id, Date.now() + FOLLOW_UP_WINDOW_MS);
          console.log(chalk.dim('等待该成员在 30 秒内补充下一条消息。'));
          return;
        }
        awaitingFollowUp.delete(event.user_id);

        replyQueue = replyQueue.then(async () => {
          try {
          toolRunner.beginTurn();
          const isCurrentInfoRequest = shouldPrefetchPublicSearch(input);
          const context = contextStore.buildAgentInput(groupId, modelConfig.historyMessages, modelConfig.maxInputChars);
          const skillContext = loadRelevantSkills(modelConfig.skillDirectory, input);
          const currentImage = contextStore.findImage(groupId, event.message_id, 1);
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
            console.log(chalk.dim(`AI 请求：上下文 ${context.length} 字，记忆 ${memory.summary.length} 字，检索 ${liveSearchResult.length} 字，图片 ${imageDescription.length} 字，工具 ${TEXT_AGENT_TOOLS.length} 个，思考模式 ${modelConfig.enableThinking ? '开' : '关'}`));
            reply = await generateGroupReply(
              context, memory.summary, modelConfig, TEXT_AGENT_TOOLS,
              (name, args) => toolRunner.run(name, args), liveSearchResult, imageDescription, skillContext, isCurrentInfoRequest,
            );
          } catch (error) {
            if (!(error instanceof Error) || !/abort|timeout/i.test(error.message)) throw error;
            console.log(chalk.yellow('AI 首次请求超时，正在以同一上下文降级重试'));
            console.log(chalk.dim(`AI 重试：上下文 ${context.length} 字，记忆 ${memory.summary.length} 字，检索 ${liveSearchResult.length} 字，图片 ${imageDescription.length} 字，工具 0 个，思考模式 ${modelConfig.enableThinking ? '开' : '关'}`));
            reply = await generateGroupReply(
              context, memory.summary, modelConfig, [], async () => 'Tool disabled.', liveSearchResult, imageDescription, skillContext, true,
            );
          }
          console.log(chalk.dim(`AI 回复耗时 ${Date.now() - replyStartedAt}ms`));
          if (!reply || !safetyManager.isAllowed(groupId)) return;
          const sent = await client.sendGroupMessage(groupId, reply);
          contextStore.recordOutgoing(groupId, sent.message_id, reply);
          console.log(chalk.green('已向授权群发送回复'));
          } catch (error) {
            console.log(chalk.red(`AI 回复失败: ${error instanceof Error ? error.message : String(error)}`));
          }
        });
      });

      process.on('SIGINT', () => {
        clearInterval(emojiTimer);
        if (memoryTimer) clearTimeout(memoryTimer);
        client.disconnect();
        process.exit(0);
      });
    });

  groupBot
    .command('emoji-sync')
    .description('同步私密收藏表情库，仅识别新增图片')
    .action(async () => {
      try {
        const config = loadGroupBotModelConfig();
        const result = await syncEmojiLibrary(config, (text) => console.log(chalk.dim(text)));
        console.log(chalk.green(`表情库同步完成：新增 ${result.added}，总计 ${result.total}`));
      } catch (error) {
        console.log(chalk.red(`表情库同步失败: ${error instanceof Error ? error.message : String(error)}`));
      }
    });

  groupBot
    .command('test-model')
    .description('用最小请求验证本地模型配置，不显示密钥或模型回复')
    .action(async () => {
      let modelConfig: GroupBotModelConfig;
      try {
        modelConfig = loadGroupBotModelConfig();
      } catch (error) {
        console.log(chalk.red(error instanceof Error ? error.message : String(error)));
        return;
      }

      try {
        const reply = await generateGroupReply('请只回复 OK。', '', modelConfig, [], async () => 'Tool disabled.');
        if (!reply) throw new Error('模型返回空内容');
        console.log(chalk.green('模型连接验证成功'));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(chalk.red(`模型连接失败: ${message}`));
      }
    });
}
