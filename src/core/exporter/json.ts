/**
 * JSON 导出器
 */

import { writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import { BaseExporter, ExportOptions, ExportResult } from './base.js';
import { Message } from '../onebot-client.js';
import { Session } from '../fetcher.js';

export class JsonExporter extends BaseExporter {
  readonly format = 'json';
  readonly extension = 'json';

  async export(session: Session, messages: Message[], options: ExportOptions): Promise<ExportResult> {
    const filePath = this.getOutputPath(session, options.output);

    // 确保目录存在
    await mkdir(dirname(filePath), { recursive: true });

    const exportData = {
      session: {
        type: session.type,
        id: session.id,
        name: session.name,
      },
      exportTime: new Date().toISOString(),
      messageCount: messages.length,
      messages: messages.map(msg => ({
        messageId: msg.message_id,
        messageSeq: msg.message_seq,
        time: this.formatTime(msg.time),
        timestamp: msg.time,
        sender: {
          id: msg.sender.user_id,
          name: msg.sender.nickname,
          card: msg.sender.card,
        },
        content: this.getMessageText(msg),
        rawMessage: msg.raw_message,
        segments: msg.message,
      })),
    };

    await writeFile(filePath, JSON.stringify(exportData, null, 2), 'utf-8');

    return {
      success: true,
      filePath,
      messageCount: messages.length,
    };
  }
}
