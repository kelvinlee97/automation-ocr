/**
 * WhatsApp Bot entrance
 * Startup sequence: Express first (/admin/qr can be accessed immediately), followed by Bot.
 * Inject QR and client through callbacks to avoid blocking the HTTP service
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

    logger.info('Old JSON data detected, migration automatically triggered...');
    // Run the migration script in a child process to avoid polluting the module cache of the current process
    const { execFileSync } = require('child_process');
    execFileSync(process.execPath, [
        path.join(__dirname, 'scripts/migrate-json-to-sqlite.js'), '--apply',
    ], { stdio: 'inherit', env: process.env });
    logger.info('JSON → SQLite migration completed');
}

async function main() {
    logger.info('Launch WhatsApp Bot (AI version)...');

    try {
        // 1. Initialize SQLite database
        db.init();
        logger.info('SQLite database initialization completed');

        // 2. Idempotent automatic migration: If old JSON exists and DB is empty, migrate
        await tryMigrateFromJson();

        // 3. Initialize session storage
        sessionManager.init();
        logger.info('Session storage initialization completed');

        // 4. Initialize Excel file
        await initExcel();
        logger.info('Excel file initialization completed');

        // 5. Express starts immediately
        startAdminServer();

        // 6. Bot initialization (does not block the Admin background when it fails)
        try {
            await createBot({
                onQR: (dataUri) => setQR(dataUri),
                onReady: (client) => setClient(client),
                // After the qr event is triggered, the adminServer is notified: the client has entered the authentication window period and can accept pairing code requests.
                onPairingCodeReady: () => setPairingCodeReady(true),
                // After the disconnected event is triggered, the adminServer is notified to reset the connection status to prevent "Connected" from still being displayed in the background.
                onDisconnected: () => setDisconnected(),
            });
            logger.info('Bot is ready and the system is fully started');
        } catch (botError) {
            setBotError(botError.message);
            logger.warn('Bot initialization failed; the admin panel is still available', { error: botError.message });
        }

        // Global error handling
        process.on('unhandledRejection', (reason) => {
            logger.error('Unhandled Rejection', { reason: reason?.stack || reason });
        });

        process.on('uncaughtException', (err) => {
            logger.error('Uncaught Exception', { stack: err.stack });
        });

    } catch (error) {
        logger.error('Startup failed:', error);
        process.exit(1);
    }
}

main();
