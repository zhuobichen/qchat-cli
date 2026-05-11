/**
 * 导出器模块
 */

export type { ExportOptions, ExportResult } from './base.js';
export { BaseExporter } from './base.js';
export { JsonExporter } from './json.js';
export { TxtExporter } from './txt.js';
export { HtmlExporter } from './html.js';
export { ExcelExporter } from './excel.js';

import { JsonExporter } from './json.js';
import { TxtExporter } from './txt.js';
import { HtmlExporter } from './html.js';
import { ExcelExporter } from './excel.js';
import { BaseExporter } from './base.js';

const exporters: Record<string, BaseExporter> = {
  json: new JsonExporter(),
  txt: new TxtExporter(),
  html: new HtmlExporter(),
  excel: new ExcelExporter(),
  csv: new ExcelExporter(), // 别名
};

export function getExporter(format: string): BaseExporter | undefined {
  return exporters[format.toLowerCase()];
}

export function getSupportedFormats(): string[] {
  return ['json', 'txt', 'html', 'excel'];
}
