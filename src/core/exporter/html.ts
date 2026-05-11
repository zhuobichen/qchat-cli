/**
 * HTML 导出器
 */

import { writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import { BaseExporter, ExportOptions, ExportResult } from './base.js';
import { Message } from '../onebot-client.js';
import { Session } from '../fetcher.js';

export class HtmlExporter extends BaseExporter {
  readonly format = 'html';
  readonly extension = 'html';

  async export(session: Session, messages: Message[], options: ExportOptions): Promise<ExportResult> {
    const filePath = this.getOutputPath(session, options.output);

    // 确保目录存在
    await mkdir(dirname(filePath), { recursive: true });

    const html = this.generateHtml(session, messages);
    await writeFile(filePath, html, 'utf-8');

    return {
      success: true,
      filePath,
      messageCount: messages.length,
    };
  }

  private generateHtml(session: Session, messages: Message[]): string {
    const title = `${session.type === 'group' ? '群聊' : '好友'}记录 - ${session.name}`;

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${this.escapeHtml(title)}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: #f5f5f5;
      padding: 20px;
    }
    .container {
      max-width: 800px;
      margin: 0 auto;
      background: white;
      border-radius: 12px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
      overflow: hidden;
    }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 24px;
    }
    .header h1 {
      font-size: 20px;
      margin-bottom: 8px;
    }
    .header .info {
      font-size: 14px;
      opacity: 0.9;
    }
    .messages {
      padding: 16px;
    }
    .message {
      margin-bottom: 16px;
      display: flex;
      flex-direction: column;
    }
    .message-header {
      display: flex;
      align-items: center;
      margin-bottom: 4px;
    }
    .sender-name {
      font-weight: 600;
      color: #333;
      margin-right: 8px;
    }
    .message-time {
      font-size: 12px;
      color: #999;
    }
    .message-content {
      background: #f0f0f0;
      padding: 10px 14px;
      border-radius: 8px;
      max-width: 80%;
      word-wrap: break-word;
      line-height: 1.5;
    }
    .message.self .message-content {
      background: #95ec69;
      margin-left: auto;
    }
    .message.other .message-content {
      background: white;
      border: 1px solid #e0e0e0;
    }
    .footer {
      padding: 16px;
      text-align: center;
      color: #999;
      font-size: 12px;
      border-top: 1px solid #eee;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${this.escapeHtml(title)}</h1>
      <div class="info">
        ID: ${session.id} | 消息数: ${messages.length} | 导出时间: ${new Date().toLocaleString('zh-CN')}
      </div>
    </div>
    <div class="messages">
      ${messages.map(msg => this.renderMessage(msg)).join('\n')}
    </div>
    <div class="footer">
      由 QQ Chat Exporter CLI 导出
    </div>
  </div>
</body>
</html>`;
  }

  private renderMessage(message: Message): string {
    const time = this.formatTime(message.time);
    const sender = message.sender.card || message.sender.nickname;
    const content = this.escapeHtml(this.getMessageText(message));

    return `
      <div class="message">
        <div class="message-header">
          <span class="sender-name">${this.escapeHtml(sender)}</span>
          <span class="message-time">${time}</span>
        </div>
        <div class="message-content">${content}</div>
      </div>`;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
