/**
 * 用户会话状态机
 * 状态流转：INIT → WAITING_IC → WAITING_RECEIPT → DONE
 * 使用内存 Map 存储，30 分钟 TTL 自动清理
 */

const logger = require('./utils/logger');

// 会话状态枚举
const SESSION_STATE = {
	WAITING_IC: 'WAITING_IC',         // 等待用户提交身份证
	WAITING_RECEIPT: 'WAITING_RECEIPT', // 注册成功，等待收据截图
	DONE: 'DONE',                       // 本次流程完成
};

// phone → session 的 Map
// session 结构：{ phone, ic, state, createdAt, updatedAt, receiptCount }
const sessions = new Map();

// 每10分钟扫描一次，清理过期 session
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;


/**
 * 获取或创建用户 session
 * 新用户默认进入 WAITING_IC 状态
 */
function getOrCreateSession(phone) {
	const config = _getConfig();
	const timeoutMs = config.bot.session_timeout_minutes * 60 * 1000;

	const existing = sessions.get(phone);
	if (existing) {
		// 检查是否超时
		if (Date.now() - existing.updatedAt > timeoutMs) {
			logger.info('会话超时，重置', { phone });
			sessions.delete(phone);
		} else {
			return existing;
		}
	}

	const session = {
		phone,
		ic: null,
		state: SESSION_STATE.WAITING_IC,
		createdAt: Date.now(),
		updatedAt: Date.now(),
		receiptCount: 0,           // 今日已提交收据次数
		receiptCountDate: _today(), // 计数对应的日期，跨天自动重置
	};
	sessions.set(phone, session);
	logger.info('新建会话', { phone, state: session.state });
	return session;
}


/**
 * 更新会话状态
 * @param {string} phone
 * @param {Partial<session>} updates
 */
function updateSession(phone, updates) {
	const session = sessions.get(phone);
	if (!session) {
		throw new Error(`会话不存在: ${phone}`);
	}
	Object.assign(session, updates, { updatedAt: Date.now() });
	logger.debug('会话更新', { phone, updates });
}


/**
 * 检查用户今日收据提交次数是否超限
 * 跨天时自动重置计数
 */
function checkReceiptLimit(phone) {
	const config = _getConfig();
	const maxPerDay = config.bot.max_receipts_per_day;

	const session = sessions.get(phone);
	if (!session) return { allowed: false, reason: '会话不存在' };

	// 跨天重置计数
	if (session.receiptCountDate !== _today()) {
		session.receiptCount = 0;
		session.receiptCountDate = _today();
	}

	if (session.receiptCount >= maxPerDay) {
		return { allowed: false, reason: `今日已达最大提交次数（${maxPerDay}次）` };
	}

	return { allowed: true };
}


/**
 * 增加收据提交计数
 */
function incrementReceiptCount(phone) {
	const session = sessions.get(phone);
	if (session) {
		session.receiptCount += 1;
		session.updatedAt = Date.now();
	}
}


/**
 * 定期清理超时 session，防止内存泄漏
 */
function startCleanupJob() {
	setInterval(() => {
		const config = _getConfig();
		const timeoutMs = config.bot.session_timeout_minutes * 60 * 1000;
		const now = Date.now();
		let cleaned = 0;

		for (const [phone, session] of sessions.entries()) {
			if (now - session.updatedAt > timeoutMs) {
				sessions.delete(phone);
				cleaned++;
			}
		}

		if (cleaned > 0) {
			logger.info(`清理过期会话 ${cleaned} 个，当前活跃会话: ${sessions.size}`);
		}
	}, CLEANUP_INTERVAL_MS);
}


function _today() {
	return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}


// 延迟加载 config，避免循环依赖
let _configCache = null;
function _getConfig() {
	if (!_configCache) {
		const yaml = require('js-yaml');
		const fs = require('fs');
		const path = require('path');
		const configPath = path.join(__dirname, '../../config/config.yaml');
		_configCache = yaml.load(fs.readFileSync(configPath, 'utf8'));
	}
	return _configCache;
}


module.exports = {
	SESSION_STATE,
	getOrCreateSession,
	updateSession,
	checkReceiptLimit,
	incrementReceiptCount,
	startCleanupJob,
};
