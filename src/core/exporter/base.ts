/**
 * 导出器基类
 */

import { Message } from '../onebot-client.js';
import { Session } from '../fetcher.js';

export interface ExportOptions {
  output: string;
  format: string;
}

export interface ExportResult {
  success: boolean;
  filePath: string;
  messageCount: number;
  error?: string;
}

export abstract class BaseExporter {
  abstract readonly format: string;
  abstract readonly extension: string;

  /**
   * 导出消息
   */
  abstract export(session: Session, messages: Message[], options: ExportOptions): Promise<ExportResult>;

  /**
   * 获取输出文件路径
   */
  protected getOutputPath(session: Session, outputDir: string): string {
    const safeName = session.name.replace(/[\/\\:*?"<>|]/g, '_');
    const fileName = `${session.type}_${session.id}_${safeName}`;
    return `${outputDir}/${fileName}.${this.extension}`;
  }

  /**
   * 格式化时间戳
   */
  protected formatTime(timestamp: number): string {
    return new Date(timestamp * 1000).toLocaleString('zh-CN');
  }

  /**
   * 获取消息文本内容
   */
  protected getMessageText(message: Message): string {
    return message.message
      .map(segment => {
        if (segment.type === 'text') return segment.data.text;
        if (segment.type === 'at') return `@${segment.data.qq}`;
        if (segment.type === 'face') return `[表情]`;
        if (segment.type === 'image') return '[图片]';
        return `[${segment.type}]`;
      })
      .join('');
  }
}
