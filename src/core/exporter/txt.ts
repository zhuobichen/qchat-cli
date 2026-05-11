/**
 * TXT 导出器
 */

import { writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import { BaseExporter, ExportOptions, ExportResult } from './base.js';
import { Message } from '../onebot-client.js';
import { Session } from '../fetcher.js';

export class TxtExporter extends BaseExporter {
  readonly format = 'txt';
  readonly extension = 'txt';

  async export(session: Session, messages: Message[], options: ExportOptions): Promise<ExportResult> {
    const filePath = this.getOutputPath(session, options.output);

    // 确保目录存在
    await mkdir(dirname(filePath), { recursive: true });

    const lines: string[] = [];

    // 文件头
    lines.push('=' .repeat(50));
    lines.push(`${session.type === 'group' ? '群聊' : '好友'}记录: ${session.name}`);
    lines.push(`ID: ${session.id}`);
    lines.push(`导出时间: ${new Date().toLocaleString('zh-CN')}`);
    lines.push(`消息数量: ${messages.length}`);
    lines.push('=' .repeat(50));
    lines.push('');

    // 消息内容
    for (const msg of messages) {
      const time = this.formatTime(msg.time);
      const sender = msg.sender.card || msg.sender.nickname;
      const content = this.getMessageText(msg);

      lines.push(`${time} ${sender}(${msg.sender.user_id})`);
      lines.push(content);
      lines.push('');
    }

    await writeFile(filePath, lines.join('\n'), 'utf-8');

    return {
      success: true,
      filePath,
      messageCount: messages.length,
    };
  }
}
