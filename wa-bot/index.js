/**
 * WhatsApp Bot 入口
 * 启动顺序：Express 先起（立即可访问 /admin/qr），Bot 后初始化
 * 通过回调注入 QR 和 client，避免阻塞 HTTP 服务
 */

const { createBot } = require('./src/bot');
const sessionManager = require('./src/sessionManager');
const { initExcel } = require('./src/services/excelService');
const { startAdminServer, setClient, setQR, setPairingCodeReady, setDisconnected } = require('./src/adminServer');
const logger = require('./src/utils/logger');

async function main() {
    logger.info('启动 WhatsApp Bot (AI 版)...');

    try {
        // 1. 初始化会话存储（本地 JSON 文件）
        sessionManager.init();
        logger.info('会话存储初始化完成');

        // 2. 初始化 Excel 文件
        await initExcel();
        logger.info('Excel 文件初始化完成');

        // 3. Express 立即启动
        startAdminServer();

        // 4. Bot 初始化
        await createBot({
            onQR: (dataUri) => setQR(dataUri),
            onReady: (client) => setClient(client),
            // qr 事件触发后通知 adminServer：client 已进入认证窗口期，可接受配对码请求
            onPairingCodeReady: () => setPairingCodeReady(true),
            // disconnected 事件触发后通知 adminServer 重置连接状态，防止后台仍显示"已连接"
            onDisconnected: () => setDisconnected(),
        });

        logger.info('Bot 已就绪，系统全面启动');

        // 全局错误处理
        process.on('unhandledRejection', (reason) => {
            logger.error('Unhandled Rejection', { reason: reason?.stack || reason });
        });

        process.on('uncaughtException', (err) => {
            logger.error('Uncaught Exception', { stack: err.stack });
        });

    } catch (error) {
        logger.error('启动失败:', error);
        process.exit(1);
    }
}

main();
