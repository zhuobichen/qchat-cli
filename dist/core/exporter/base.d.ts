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
export declare abstract class BaseExporter {
    abstract readonly format: string;
    abstract readonly extension: string;
    /**
     * 导出消息
     */
    abstract export(session: Session, messages: Message[], options: ExportOptions): Promise<ExportResult>;
    /**
     * 获取输出文件路径
     */
    protected getOutputPath(session: Session, outputDir: string): string;
    /**
     * 格式化时间戳
     */
    protected formatTime(timestamp: number): string;
    /**
     * 获取消息文本内容
     */
    protected getMessageText(message: Message): string;
}
//# sourceMappingURL=base.d.ts.map