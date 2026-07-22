/**
 * WhatsApp Bot 入口
 * 启动顺序：Express 先起（立即可访问 /admin/qr），Bot 后初始化
 * 通过回调注入 QR 和 client，避免阻塞 HTTP 服务
 */

const { createBot } = require('./src/bot');
const sessionManager = require('./src/sessionManager');
const { initExcel } = require('./src/services/excelService');
const { startAdminServer, setClient, setQR, setPairingCodeReady, setDisconnected, setBotError } = require('./src/adminServer');
const logger = require('./src/utils/logger');
const db = require('./src/db');

async function tryMigrateFromJson() {
    const fs   = require('fs');
    const path = require('path');
    const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, '../data');
    const RECEIPTS_JSON = path.join(DATA_DIR, 'pending_receipts.json');
    const SESSIONS_JSON = path.join(DATA_DIR, 'sessions.json');
    const USERS_JSON    = path.join(DATA_DIR, 'admin_users.json');

    const hasJson = fs.existsSync(RECEIPTS_JSON) || fs.existsSync(SESSIONS_JSON) || fs.existsSync(USERS_JSON);
    if (!hasJson) return;

    const existingReceipts = db.db.prepare('SELECT COUNT(*) as c FROM receipts').get().c;
    const existingSessions = db.db.prepare('SELECT COUNT(*) as c FROM sessions').get().c;
    const existingUsers    = db.db.prepare('SELECT COUNT(*) as c FROM admin_users').get().c;
    if (existingReceipts > 0 || existingSessions > 0 || existingUsers > 0) return;

    logger.info('检测到旧 JSON 数据，自动触发迁移...');
    // 在子进程中运行迁移脚本，避免污染当前进程的模块缓存
    const { execFileSync } = require('child_process');
    execFileSync(process.execPath, [
        path.join(__dirname, 'scripts/migrate-json-to-sqlite.js'), '--apply',
    ], { stdio: 'inherit', env: process.env });
    logger.info('JSON → SQLite 迁移完成');
}

async function main() {
    logger.info('启动 WhatsApp Bot (AI 版)...');

    try {
        // 1. 初始化 SQLite 数据库
        db.init();
        logger.info('SQLite 数据库初始化完成');

        // 2. 幂等自动迁移：若存在旧 JSON 且 DB 为空，则迁移
        await tryMigrateFromJson();

        // 3. 初始化会话存储
        sessionManager.init();
        logger.info('会话存储初始化完成');

        // 4. 初始化 Excel 文件
        await initExcel();
        logger.info('Excel 文件初始化完成');

        // 5. Express 立即启动
        startAdminServer();

        // 6. Bot 初始化（失败时不阻塞 Admin 后台）
        try {
            await createBot({
                onQR: (dataUri) => setQR(dataUri),
                onReady: (client) => setClient(client),
                // qr 事件触发后通知 adminServer：client 已进入认证窗口期，可接受配对码请求
                onPairingCodeReady: () => setPairingCodeReady(true),
                // disconnected 事件触发后通知 adminServer 重置连接状态，防止后台仍显示"已连接"
                onDisconnected: () => setDisconnected(),
            });
            logger.info('Bot 已就绪，系统全面启动');
        } catch (botError) {
            setBotError(botError.message);
            logger.warn('Bot 初始化失败，Admin 后台仍可用', { error: botError.message });
        }

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
