/**
 * Excel 导出器
 * 使用 CSV 格式，可直接用 Excel 打开
 */
import { BaseExporter, ExportOptions, ExportResult } from './base.js';
import { Message } from '../onebot-client.js';
import { Session } from '../fetcher.js';
export declare class ExcelExporter extends BaseExporter {
    readonly format = "excel";
    readonly extension = "csv";
    export(session: Session, messages: Message[], options: ExportOptions): Promise<ExportResult>;
    private generateCsv;
    private buildRow;
    private escapeCsv;
}
//# sourceMappingURL=excel.d.ts.map