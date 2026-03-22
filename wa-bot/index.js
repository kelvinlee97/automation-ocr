/**
 * WhatsApp Bot 入口
 * 重构版：直接调用 Gemini AI，不再依赖 Python OCR
 */

const { createBot } = require('./src/bot');
const { startCleanupJob } = require('./src/sessionManager');
const { initExcel } = require('./src/services/excelService');
const { startAdminServer } = require('./src/adminServer');
const logger = require('./src/utils/logger');

async function main() {
    logger.info('启动 WhatsApp Bot (AI 版)...');

    try {
        // 1. 初始化 Excel 文件 (确保 data/ 目录和表头存在)
        await initExcel();
        logger.info('Excel 文件初始化完成');

        // 2. 启动会话清理任务 (内存会话过期管理)
        startCleanupJob();
        logger.info('Session 清理定时任务已启动');

        // 3. 创建并启动 Bot
        const client = await createBot();
        logger.info('Bot 已创建，等待连接...');

        // 4. 启动管理后台（共享同一 WhatsApp client 实例）
        startAdminServer(client);

        // 全局错误处理
        process.on('unhandledRejection', (reason, promise) => {
            logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
        });

        process.on('uncaughtException', (err) => {
            logger.error('Uncaught Exception:', err);
        });

    } catch (error) {
        logger.error('启动失败:', error);
        process.exit(1);
    }
}

main();
