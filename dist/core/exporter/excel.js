/**
 * Excel 导出器
 * 使用 CSV 格式，可直接用 Excel 打开
 */
import { writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import { BaseExporter } from './base.js';
export class ExcelExporter extends BaseExporter {
    format = 'excel';
    extension = 'csv';
    async export(session, messages, options) {
        const filePath = this.getOutputPath(session, options.output);
        // 确保目录存在
        await mkdir(dirname(filePath), { recursive: true });
        const csv = this.generateCsv(session, messages);
        // 添加 BOM 以支持中文
        await writeFile(filePath, '\uFEFF' + csv, 'utf-8');
        return {
            success: true,
            filePath,
            messageCount: messages.length,
        };
    }
    generateCsv(session, messages) {
        const rows = [];
        // 表头
        rows.push(this.buildRow(['消息ID', '时间', '发送者ID', '发送者昵称', '内容', '原始消息']));
        // 数据行
        for (const msg of messages) {
            rows.push(this.buildRow([
                msg.message_id.toString(),
                this.formatTime(msg.time),
                msg.sender.user_id.toString(),
                msg.sender.card || msg.sender.nickname,
                this.getMessageText(msg),
                msg.raw_message,
            ]));
        }
        return rows.join('\n');
    }
    buildRow(fields) {
        return fields.map(field => this.escapeCsv(field)).join(',');
    }
    escapeCsv(value) {
        // 如果包含逗号、双引号或换行符，用双引号包裹
        if (value.includes(',') || value.includes('"') || value.includes('\n')) {
            return `"${value.replace(/"/g, '""')}"`;
        }
        return value;
    }
}
//# sourceMappingURL=excel.js.map