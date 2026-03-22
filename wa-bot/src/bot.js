/**
 * WhatsApp Bot 初始化模块
 * 封装 whatsapp-web.js 的初始化、QR 码展示、断线重连逻辑
 */

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { handleMessage } = require('./messageHandler');
const logger = require('./utils/logger');

// 断线后最大重连次数
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY_MS = 5000;


/**
 * 创建并启动 WhatsApp Bot
 * 使用 LocalAuth 持久化 session，重启后无需重新扫码
 * @param {Object} callbacks
 * @param {Function} [callbacks.onQR]    - QR 码刷新时回调，参数为 base64 data URI
 * @param {Function} [callbacks.onReady] - Bot 就绪时回调，参数为 client 实例
 */
async function createBot({ onQR, onReady } = {}) {
	const client = new Client({
		authStrategy: new LocalAuth({
			dataPath: '.wwebjs_auth',
		}),
		puppeteer: {
			headless: true,
			args: [
				'--no-sandbox',
				'--disable-setuid-sandbox',
				'--disable-dev-shm-usage',  // 低内存环境必需
			],
		},
	});

	let reconnectAttempts = 0;
	let isReconnecting = false;

	// QR 码扫码（首次登录或 session 失效时触发）
	client.on('qr', async (qr) => {
		logger.info('请扫描二维码登录 WhatsApp');
		qrcode.generate(qr, { small: true }); // 保留终端显示，方便 SSH 调试

		// 将 QR 转为 base64 data URI 注入管理后台 Web 页面
		if (onQR) {
			try {
				const QRCode = require('qrcode');
				const dataUri = await QRCode.toDataURL(qr);
				onQR(dataUri);
			} catch (err) {
				logger.error('QR 码转 base64 失败', { error: err.message });
			}
		}
	});

	// 登录成功：此时才注册消息监听，避免处理 ready 之前同步的离线积压消息
	client.on('ready', () => {
		reconnectAttempts = 0;
		logger.info('WhatsApp Bot 已就绪');

		// 记录就绪时间戳，用于过滤 ready 后仍陆续到达的旧消息
		const readyTimestamp = Date.now() / 1000;

		// 先移除旧的监听器（断线重连时 ready 会再次触发），防止重复注册
		client.removeAllListeners('message');
		client.on('message', async (message) => {
			if (message.fromMe) return;
			if (!message.timestamp || message.timestamp < readyTimestamp) return;
			await handleMessage(message);
		});

		// 通知外部（adminServer）client 已就绪
		if (onReady) onReady(client);
	});

	// 认证失败
	client.on('authenticated', () => {
                logger.info('WhatsApp 认证成功');
        });

        // 认证失败
        client.on('auth_failure', (msg) => {
		logger.error('WhatsApp 认证失败，请删除 .wwebjs_auth 目录后重新扫码', { msg });
	});

	// 断线处理：指数退避重连
	client.on('disconnected', async (reason) => {
		logger.warn('WhatsApp 已断线', { reason, reconnectAttempts });

		// 防止 disconnected 事件多次触发导致并发重连
		if (isReconnecting) {
			logger.warn('已有重连任务进行中，跳过本次触发');
			return;
		}

		if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
			logger.error('达到最大重连次数，请手动重启服务');
			process.exit(1);
		}

		const delay = RECONNECT_DELAY_MS * Math.pow(2, reconnectAttempts);
		reconnectAttempts++;
		isReconnecting = true;
		logger.info(`${delay / 1000} 秒后尝试第 ${reconnectAttempts} 次重连...`);

		setTimeout(async () => {
			try {
				await client.initialize();
			} catch (err) {
				logger.error('重连失败', { error: err.message });
			} finally {
				isReconnecting = false;
			}
		}, delay);
	});

	// 启动 WhatsApp 连接，触发 QR 码生成
	await client.initialize();

	return client;
}


module.exports = { createBot };
