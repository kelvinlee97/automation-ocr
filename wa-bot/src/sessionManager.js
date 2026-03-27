/**
 * 用户会话状态机
 * 状态流转：INIT → WAITING_IC → WAITING_RECEIPT → DONE
 * 使用 Redis 存储，支持内存降级模式
 */

const logger = require('./utils/logger');
const redisClient = require('./redisClient');

const SESSION_STATE = {
	WAITING_IC: 'WAITING_IC',
	WAITING_RECEIPT: 'WAITING_RECEIPT',
	DONE: 'DONE',
};

const SESSION_PREFIX = 'session:';
const MEMORY_SESSIONS_KEY = 'memory_sessions';
const MEMORY_SESSION_MAP = new Map();

let config = null;
let redis = null;

function _getConfig() {
	if (!config) {
		const yaml = require('js-yaml');
		const fs = require('fs');
		const path = require('path');
		const configPath = path.join(__dirname, '../../config/config.yaml');
		config = yaml.load(fs.readFileSync(configPath, 'utf8'));
	}
	return config;
}

function _getRedis() {
	if (!redis) {
		redis = redisClient.getClient();
	}
	return redis;
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

function _sessionKey(phone) {
	return `${SESSION_PREFIX}${phone}`;
}

async function _memoryGetSession(phone) {
	const r = _getRedis();
	const data = await r.hgetall(_sessionKey(phone));
	if (!data || Object.keys(data).length === 0) {
		return null;
	}
	return _deserialize(data);
}

async function _memorySetSession(phone, session) {
	const r = _getRedis();
	const data = _serialize(session);
	await r.hset(_sessionKey(phone), data);
	await r.expire(_sessionKey(phone), Math.floor(_getTimeoutMs() / 1000));
}

async function _memoryDeleteSession(phone) {
	const r = _getRedis();
	await r.del(_sessionKey(phone));
}

async function _memoryGetAllSessions() {
	const r = _getRedis();
	const keys = await r.keys(`${SESSION_PREFIX}*`);
	if (keys.length === 0) return [];
	
	const pipeline = r.pipeline();
	for (const key of keys) {
		pipeline.hgetall(key);
	}
	const results = await pipeline.exec();
	
	const sessions = [];
	for (const [err, data] of results) {
		if (!err && data && Object.keys(data).length > 0) {
			sessions.push(_deserialize(data));
		}
	}
	return sessions;
}

function _serialize(session) {
	const obj = {};
	for (const [key, value] of Object.entries(session)) {
		obj[key] = typeof value === 'object' ? JSON.stringify(value) : String(value);
	}
	return obj;
}

function _deserialize(obj) {
	return {
		phone: obj.phone,
		ic: obj.ic === 'null' ? null : obj.ic,
		state: obj.state,
		createdAt: parseInt(obj.createdAt, 10),
		updatedAt: parseInt(obj.updatedAt, 10),
		receiptCount: parseInt(obj.receiptCount, 10) || 0,
		receiptCountDate: obj.receiptCountDate || _today(),
	};
}

async function _memoryFallbackGet(phone) {
	const data = MEMORY_SESSION_MAP.get(phone);
	if (!data) return null;
	
	const session = data;
	if (Date.now() - session.updatedAt > _getTimeoutMs()) {
		MEMORY_SESSION_MAP.delete(phone);
		return null;
	}
	return session;
}

async function _memoryFallbackSet(phone, session) {
	MEMORY_SESSION_MAP.set(phone, session);
}

async function _memoryFallbackDelete(phone) {
	MEMORY_SESSION_MAP.delete(phone);
}

async function _memoryFallbackGetAll() {
	const timeoutMs = _getTimeoutMs();
	const now = Date.now();
	const expired = [];
	
	for (const [phone, session] of MEMORY_SESSION_MAP.entries()) {
		if (now - session.updatedAt > timeoutMs) {
			expired.push(phone);
		}
	}
	
	for (const phone of expired) {
		MEMORY_SESSION_MAP.delete(phone);
	}
	
	return Array.from(MEMORY_SESSION_MAP.values());
}

async function getOrCreateSession(phone) {
	const useMemory = redisClient.isMemoryFallback();
	
	let session;
	if (useMemory) {
		session = await _memoryFallbackGet(phone);
	} else {
		session = await _memoryGetSession(phone);
	}
	
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
	
	if (useMemory) {
		await _memoryFallbackSet(phone, session);
	} else {
		await _memorySetSession(phone, session);
	}
	
	logger.info('新建会话', { phone: _maskPhone(phone), state: session.state });
	return session;
}

async function updateSession(phone, updates) {
	const useMemory = redisClient.isMemoryFallback();
	
	let session;
	if (useMemory) {
		session = await _memoryFallbackGet(phone);
	} else {
		session = await _memoryGetSession(phone);
	}
	
	if (!session) {
		throw new Error(`会话不存在: ${phone}`);
	}
	
	Object.assign(session, updates, { updatedAt: Date.now() });
	
	if (useMemory) {
		await _memoryFallbackSet(phone, session);
	} else {
		await _memorySetSession(phone, session);
	}
	
	logger.debug('会话更新', { phone: _maskPhone(phone), updates });
}

async function checkReceiptLimit(phone) {
	const maxPerDay = _getMaxPerDay();
	const useMemory = redisClient.isMemoryFallback();
	
	let session;
	if (useMemory) {
		session = await _memoryFallbackGet(phone);
	} else {
		session = await _memoryGetSession(phone);
	}
	
	if (!session) {
		return { allowed: false, reason: '会话不存在' };
	}
	
	if (session.receiptCountDate !== _today()) {
		session.receiptCount = 0;
		session.receiptCountDate = _today();
		
		if (useMemory) {
			await _memoryFallbackSet(phone, session);
		} else {
			await _memorySetSession(phone, session);
		}
	}
	
	if (session.receiptCount >= maxPerDay) {
		return { allowed: false, reason: `今日已达最大提交次数（${maxPerDay}次）` };
	}
	
	return { allowed: true };
}

async function incrementReceiptCount(phone) {
	const useMemory = redisClient.isMemoryFallback();
	
	let session;
	if (useMemory) {
		session = await _memoryFallbackGet(phone);
	} else {
		session = await _memoryGetSession(phone);
	}
	
	if (session) {
		session.receiptCount += 1;
		session.updatedAt = Date.now();
		
		if (useMemory) {
			await _memoryFallbackSet(phone, session);
		} else {
			await _memorySetSession(phone, session);
		}
	}
}

async function getAllSessions() {
	const useMemory = redisClient.isMemoryFallback();
	
	if (useMemory) {
		return _memoryFallbackGetAll();
	}
	return _memoryGetAllSessions();
}

function _maskPhone(phone) {
	if (!phone) return '';
	const last4 = phone.slice(-4);
	return `****${last4}`;
}

function init(redisClient) {
	logger.info('SessionManager 初始化', { mode: redisClient.isMemoryFallback() ? 'memory' : 'redis' });
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
