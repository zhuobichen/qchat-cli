/**
 * 导出器基类
 */
export class BaseExporter {
    /**
     * 获取输出文件路径
     */
    getOutputPath(session, outputDir) {
        const safeName = session.name.replace(/[\/\\:*?"<>|]/g, '_');
        const fileName = `${session.type}_${session.id}_${safeName}`;
        return `${outputDir}/${fileName}.${this.extension}`;
    }
    /**
     * 格式化时间戳
     */
    formatTime(timestamp) {
        return new Date(timestamp * 1000).toLocaleString('zh-CN');
    }
    /**
     * 获取消息文本内容
     */
    getMessageText(message) {
        return message.message
            .map(segment => {
            if (segment.type === 'text')
                return segment.data.text;
            if (segment.type === 'at')
                return `@${segment.data.qq}`;
            if (segment.type === 'face')
                return `[表情]`;
            if (segment.type === 'image')
                return '[图片]';
            return `[${segment.type}]`;
        })
            .join('');
    }
}
//# sourceMappingURL=base.js.map