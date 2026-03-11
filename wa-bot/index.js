/**
 * WhatsApp Bot 入口
 * 启动前检查 OCR 服务可用性
 */

const { createBot } = require('./src/bot');
const { startCleanupJob } = require('./src/sessionManager');
const { healthCheck } = require('./src/ocrClient');
const logger = require('./src/utils/logger');

const HEALTH_CHECK_INTERVAL_MS = 60 * 1000; // 每分钟检查一次 OCR 服务


async function main() {
	logger.info('启动 WhatsApp Bot...');

	// 启动时检查 OCR 服务
	const ocrAvailable = await healthCheck();
	if (!ocrAvailable) {
		logger.warn('OCR 服务暂时不可用，Bot 仍将启动，收据功能暂时受限');
	} else {
		logger.info('OCR 服务连接正常');
	}

	// 启动 session 定时清理任务
	startCleanupJob();

	// 定期检测 OCR 服务（仅记录日志，不中断 Bot）
	setInterval(async () => {
		const available = await healthCheck();
		if (!available) {
			logger.warn('OCR 服务心跳检测失败');
		}
	}, HEALTH_CHECK_INTERVAL_MS);

	// 初始化并启动 Bot
	const client = createBot();
	await client.initialize();
}


// 捕获未处理的异常，防止进程崩溃
process.on('unhandledRejection', (reason) => {
	logger.error('未处理的 Promise 拒绝', { reason: String(reason) });
});

process.on('uncaughtException', (err) => {
	logger.error('未捕获的异常', { error: err.message, stack: err.stack });
	process.exit(1);
});


main().catch((err) => {
	logger.error('Bot 启动失败', { error: err.message });
	process.exit(1);
});
