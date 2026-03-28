/**
 * 用户会话状态机
 * 状态流转：WAITING_IC → WAITING_RECEIPT → DONE
 * 使用本地 JSON 文件存储，Bot 重启后自动恢复
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const logger = require('./utils/logger');

const SESSION_STATE = {
	WAITING_IC: 'WAITING_IC',
	WAITING_RECEIPT: 'WAITING_RECEIPT',
	DONE: 'DONE',
};

const SESSIONS_FILE = path.join(__dirname, '../../../data/sessions.json');

let config = null;
let sessionsCache = null;

function _getConfig() {
	if (!config) {
		const configPath = path.join(__dirname, '../../config/config.yaml');
		config = yaml.load(fs.readFileSync(configPath, 'utf8'));
	}
	return config;
}

function _getTimeoutMs() {
	const cfg = _getConfig();
	return cfg.bot.session_timeout_minutes * 60 * 1000;
}

function _getMaxPerDay() {
	const cfg = _getConfig();
	return cfg.bot.max_receipts_per_day;
}

function _today() {
	return new Date().toISOString().slice(0, 10);
}

function _ensureDataDir() {
	const dir = path.dirname(SESSIONS_FILE);
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
}

function _loadSessions() {
	if (sessionsCache) return sessionsCache;

	_ensureDataDir();

	if (!fs.existsSync(SESSIONS_FILE)) {
		sessionsCache = {};
		fs.writeFileSync(SESSIONS_FILE, JSON.stringify({}, null, 2), 'utf8');
		return sessionsCache;
	}

	try {
		const data = fs.readFileSync(SESSIONS_FILE, 'utf8');
		sessionsCache = JSON.parse(data);
	} catch (err) {
		logger.error('读取会话文件失败，使用空会话', { error: err.message });
		sessionsCache = {};
	}

	return sessionsCache;
}

function _saveSessions(sessions) {
	sessionsCache = sessions;
	_ensureDataDir();
	fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2), 'utf8');
}

function _getSession(phone) {
	const sessions = _loadSessions();
	const session = sessions[phone];

	if (!session) return null;

	if (Date.now() - session.updatedAt > _getTimeoutMs()) {
		delete sessions[phone];
		_saveSessions(sessions);
		return null;
	}

	return session;
}

function _setSession(phone, session) {
	const sessions = _loadSessions();
	sessions[phone] = session;
	_saveSessions(sessions);
}

function _deleteSession(phone) {
	const sessions = _loadSessions();
	delete sessions[phone];
	_saveSessions(sessions);
}

function getOrCreateSession(phone) {
	let session = _getSession(phone);

	if (session) {
		logger.debug('获取已有会话', { phone: _maskPhone(phone), state: session.state });
		return session;
	}

	session = {
		phone,
		ic: null,
		state: SESSION_STATE.WAITING_IC,
		createdAt: Date.now(),
		updatedAt: Date.now(),
		receiptCount: 0,
		receiptCountDate: _today(),
	};

	_setSession(phone, session);

	logger.info('新建会话', { phone: _maskPhone(phone), state: session.state });
	return session;
}

function updateSession(phone, updates) {
	const session = _getSession(phone);

	if (!session) {
		throw new Error(`会话不存在: ${phone}`);
	}

	Object.assign(session, updates, { updatedAt: Date.now() });
	_setSession(phone, session);

	logger.debug('会话更新', { phone: _maskPhone(phone), updates });
}

function checkReceiptLimit(phone) {
	const maxPerDay = _getMaxPerDay();
	const session = _getSession(phone);

	if (!session) {
		return { allowed: false, reason: '会话不存在' };
	}

	if (session.receiptCountDate !== _today()) {
		session.receiptCount = 0;
		session.receiptCountDate = _today();
		_setSession(phone, session);
	}

	if (session.receiptCount >= maxPerDay) {
		return { allowed: false, reason: `今日已达最大提交次数（${maxPerDay}次）` };
	}

	return { allowed: true };
}

function incrementReceiptCount(phone) {
	const session = _getSession(phone);

	if (session) {
		session.receiptCount += 1;
		session.updatedAt = Date.now();
		_setSession(phone, session);
	}
}

function getAllSessions() {
	const sessions = _loadSessions();
	const timeoutMs = _getTimeoutMs();
	const now = Date.now();
	const validSessions = [];

	for (const session of Object.values(sessions)) {
		if (now - session.updatedAt <= timeoutMs) {
			validSessions.push(session);
		}
	}

	return validSessions;
}

function _maskPhone(phone) {
	if (!phone) return '';
	const last4 = phone.slice(-4);
	return `****${last4}`;
}

function init() {
	logger.info('SessionManager 初始化', { mode: 'file' });
}

module.exports = {
	SESSION_STATE,
	getOrCreateSession,
	updateSession,
	checkReceiptLimit,
	incrementReceiptCount,
	getAllSessions,
	init,
};
