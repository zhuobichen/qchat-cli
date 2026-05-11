/**
 * JSON 导出器
 */
import { BaseExporter, ExportOptions, ExportResult } from './base.js';
import { Message } from '../onebot-client.js';
import { Session } from '../fetcher.js';
export declare class JsonExporter extends BaseExporter {
    readonly format = "json";
    readonly extension = "json";
    export(session: Session, messages: Message[], options: ExportOptions): Promise<ExportResult>;
}
//# sourceMappingURL=json.d.ts.map