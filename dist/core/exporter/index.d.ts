/**
 * 导出器模块
 */
export type { ExportOptions, ExportResult } from './base.js';
export { BaseExporter } from './base.js';
export { JsonExporter } from './json.js';
export { TxtExporter } from './txt.js';
export { HtmlExporter } from './html.js';
export { ExcelExporter } from './excel.js';
import { BaseExporter } from './base.js';
export declare function getExporter(format: string): BaseExporter | undefined;
export declare function getSupportedFormats(): string[];
//# sourceMappingURL=index.d.ts.map