/**
 * WhatsApp Bot 入口
 * 启动顺序：Express 先起（立即可访问 /admin/qr），Bot 后初始化
 * 通过回调注入 QR 和 client，避免阻塞 HTTP 服务
 */

const { createBot } = require('./src/bot');
const { startCleanupJob } = require('./src/sessionManager');
const { initExcel } = require('./src/services/excelService');
const { startAdminServer, setClient, setQR } = require('./src/adminServer');
const logger = require('./src/utils/logger');

async function main() {
    logger.info('启动 WhatsApp Bot (AI 版)...');

    try {
        // 1. 初始化 Excel 文件（确保 data/ 目录和表头存在）
        await initExcel();
        logger.info('Excel 文件初始化完成');

        // 2. 启动会话清理任务（内存会话过期管理）
        startCleanupJob();
        logger.info('Session 清理定时任务已启动');

        // 3. Express 立即启动（此时 _client 为 null，/admin/qr 已可访问）
        startAdminServer();

        // 4. Bot 初始化——通过回调注入 QR 和 client，不阻塞 HTTP 服务
        //    createBot 在 ready 事件触发后 resolve，期间 Express 照常响应请求
        await createBot({
            onQR: (dataUri) => setQR(dataUri),
            onReady: (client) => setClient(client),
        });

        logger.info('Bot 已就绪，系统全面启动');

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
