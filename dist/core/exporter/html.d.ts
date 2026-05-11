/**
 * HTML 导出器
 */
import { BaseExporter, ExportOptions, ExportResult } from './base.js';
import { Message } from '../onebot-client.js';
import { Session } from '../fetcher.js';
export declare class HtmlExporter extends BaseExporter {
    readonly format = "html";
    readonly extension = "html";
    export(session: Session, messages: Message[], options: ExportOptions): Promise<ExportResult>;
    private generateHtml;
    private renderMessage;
    private escapeHtml;
}
//# sourceMappingURL=html.d.ts.map