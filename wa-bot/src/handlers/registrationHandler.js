/**
 * 注册流程处理器
 * 引导用户提交 IC → 验证 → 注册写入 Excel
 */

const { validateIC } = require('../utils/icParser');
const { SESSION_STATE, updateSession } = require('../sessionManager');
const { registerUser } = require('../ocrClient');
const logger = require('../utils/logger');

let _messages = null;

function _getMessages() {
	if (!_messages) {
		const yaml = require('js-yaml');
		const fs = require('fs');
		const path = require('path');
		_messages = yaml.load(fs.readFileSync(
			path.join(__dirname, '../../../config/messages.yaml'), 'utf8'
		));
	}
	return _messages;
}


/**
 * 处理注册阶段的文本消息
 * 当前状态为 WAITING_IC 时调用
 */
async function handleRegistration(message, session) {
	const messages = _getMessages();
	const text = message.body.trim();

	// 验证 IC 格式
	const { valid, normalized, reason } = validateIC(text);
	if (!valid) {
		logger.info('IC 格式无效', { phone: session.phone, input: text, reason });
		await message.reply(messages.registration.ic_invalid);
		return;
	}

	// 调用 Python 服务注册
	let result;
	try {
		result = await registerUser({ phone: session.phone, icNumber: normalized });
	} catch (err) {
		logger.error('注册 API 调用失败', { phone: session.phone, error: err.message });
		await message.reply(messages.errors.service_unavailable);
		return;
	}

	// IC 重复注册
	if (result.duplicate) {
		logger.warn('重复 IC 注册尝试', { phone: session.phone, ic: normalized });
		await message.reply(messages.registration.ic_duplicate);
		return;
	}

	// 注册成功，更新会话状态
	updateSession(session.phone, {
		ic: normalized,
		state: SESSION_STATE.WAITING_RECEIPT,
	});

	logger.info('注册成功', { phone: session.phone, ic: normalized });
	await message.reply(messages.registration.success);
}


module.exports = { handleRegistration };
