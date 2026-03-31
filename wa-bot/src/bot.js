/**
 * WhatsApp Bot 初始化模块
 * 封装 whatsapp-web.js 的初始化、QR 码展示、断线重连逻辑
 */

const fs = require('fs');
const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');
const { handleMessage } = require('./messageHandler');
const logger = require('./utils/logger');

// 断线后最大重连次数
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY_MS = 5000;

// Chromium user data 目录，与 LocalAuth dataPath 保持一致
const AUTH_DATA_PATH = '.wwebjs_auth';

/**
 * 清理 Chromium 遗留的 Singleton 锁文件
 * 容器重启后旧的 SingletonLock/SingletonCookie/SingletonSocket 仍残留在
 * 持久化 volume 中，导致新进程认为 profile 已被其他主机占用而拒绝启动
 */
function clearChromiumSingletonLocks() {
	// LocalAuth 将 session 存储在 <dataPath>/session-<clientId>/ 下，默认 clientId 为 'default'
	const sessionDir = path.join(AUTH_DATA_PATH, 'session-default');
	const lockPatterns = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];

	for (const name of lockPatterns) {
		const lockPath = path.join(sessionDir, name);
		try {
			fs.unlinkSync(lockPath);
			logger.info(`已清理 Chromium 锁文件: ${lockPath}`);
		} catch (err) {
			// ENOENT 表示文件不存在，属于正常情况（首次启动或已清理），不需要记录
			if (err.code !== 'ENOENT') {
				logger.warn(`清理锁文件失败: ${lockPath}`, { error: err.message });
			}
		}
	}
}


// 模块级 client 引用，供 requestPairingCode 使用
// 不直接导出 client，避免外部持有引用造成生命周期混乱
let _activeClient = null;

/**
 * 创建并启动 WhatsApp Bot
 * 使用 LocalAuth 持久化 session，重启后无需重新扫码
 * @param {Object} callbacks
 * @param {Function} [callbacks.onQR]               - QR 码刷新时回调，参数为 base64 data URI
 * @param {Function} [callbacks.onReady]             - Bot 就绪时回调，参数为 client 实例
 * @param {Function} [callbacks.onPairingCodeReady]  - client 进入可请求配对码状态时回调（qr 事件触发后）
 */
async function createBot({ onQR, onReady, onPairingCodeReady } = {}) {
	// 每次启动前清理残留锁文件，防止容器重启后 Chromium 因 profile 被"占用"而无法启动
	clearChromiumSingletonLocks();

	const client = new Client({
		authStrategy: new LocalAuth({
			dataPath: AUTH_DATA_PATH,
		}),
		puppeteer: {
			headless: true,
			args: [
				// ── 安全 / 沙盒（容器环境必需）──────────────────────────
				'--no-sandbox',
				'--disable-setuid-sandbox',

				// ── 内存优化（914MB 低内存机器）────────────────────────
				// /dev/shm 在 Docker 中默认只有 64MB，改用 /tmp 避免共享内存不足崩溃
				'--disable-dev-shm-usage',
				// 禁用 GPU 进程，无头模式不需要，可节省 ~40MB
				'--disable-gpu',
				// 限制 V8 老生代堆上限，WhatsApp Web 正常运行无需超过此值
				'--js-flags=--max-old-space-size=128',
				// 只保留一个 renderer 进程，避免多 tab 时内存倍增
				'--renderer-process-limit=1',
				// 禁用不必要的后台功能，减少后台内存占用
				'--disable-background-networking',
				'--disable-default-apps',
				'--disable-extensions',
				'--disable-sync',
				'--metrics-recording-only',
				'--no-first-run',
			],
		},
	});

	// 保存到模块级，供 requestPairingCode 在 qr 事件后使用
	_activeClient = client;

	let reconnectAttempts = 0;
	let isReconnecting = false;

	// QR 码扫码（首次登录或 session 失效时触发）
	client.on('qr', async (qr) => {
		logger.info('请扫描二维码登录 WhatsApp');
		// SSH 场景下可将此字符串复制到 QR 生成工具（如 qr.io）扫码
		logger.debug('QR data: %s', qr);
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

		// qr 事件触发说明 client 已初始化且进入认证窗口期，此时可调用 requestPairingCode
		// 通知 adminServer：现在可以接受配对码请求了
		if (onPairingCodeReady) onPairingCodeReady();
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
				// 断线重连前同样需要清理锁文件，防止 Chromium 异常退出后残留锁导致重连失败
				clearChromiumSingletonLocks();
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

/**
 * 向已连接的 WhatsApp 客户端请求配对码
 * 必须在 qr 事件触发后（client 已初始化但未认证）调用
 * @param {string} phone - 含国际区号的纯数字手机号，如 "601234567890"
 * @returns {Promise<string>} 8 位配对码，如 "WXYZ-ABCD"
 */
async function requestPairingCode(phone) {
	if (!_activeClient) {
		throw new Error('WhatsApp client 尚未初始化');
	}

	// whatsapp-web.js 仅在 pairWithPhoneNumber 模式初始化时，才通过 page.exposeFunction()
	// 将 onCodeReceivedEvent 注入到 Puppeteer 浏览器上下文。
	// QR 模式启动后手动调用 requestPairingCode()，该函数不存在于 window，
	// 导致 page.evaluate() 内部抛出 "window.onCodeReceivedEvent is not a function"。
	// 此处先检测再按需注入，避免重复注册（exposeFunction 重复调用会报错）。
	const page = _activeClient.pupPage;
	const alreadyExposed = await page.evaluate(
		() => typeof window.onCodeReceivedEvent === 'function'
	);
	if (!alreadyExposed) {
		await page.exposeFunction('onCodeReceivedEvent', (code) => {
			// 将配对码通过标准 EventEmitter 事件冒泡到业务层
			_activeClient.emit('code', code);
			return code;
		});
	}

	// whatsapp-web.js 要求手机号为纯数字字符串（含国际区号）
	return await _activeClient.requestPairingCode(phone);
}


module.exports = { createBot, requestPairingCode };
