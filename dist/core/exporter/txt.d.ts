/**
 * TXT 导出器
 */
import { BaseExporter, ExportOptions, ExportResult } from './base.js';
import { Message } from '../onebot-client.js';
import { Session } from '../fetcher.js';
export declare class TxtExporter extends BaseExporter {
    readonly format = "txt";
    readonly extension = "txt";
    export(session: Session, messages: Message[], options: ExportOptions): Promise<ExportResult>;
}
//# sourceMappingURL=txt.d.ts.map