/**
 * 消息路由分发器
 * 根据消息类型（文本/图片）和会话状态，分发到对应的处理器
 */

const { SESSION_STATE, getOrCreateSession, updateSession } = require('./sessionManager');
const { handleRegistration } = require('./handlers/registrationHandler');
const { handleReceipt } = require('./handlers/receiptHandler');
const logger = require('./utils/logger');

let _messages = null;

function _getMessages() {
	if (!_messages) {
		const yaml = require('js-yaml');
		const fs = require('fs');
		const path = require('path');
		_messages = yaml.load(fs.readFileSync(
			path.join(__dirname, '../../config/messages.yaml'), 'utf8'
		));
	}
	return _messages;
}


/**
 * 主消息处理入口
 * @param {import('whatsapp-web.js').Message} message
 */
async function handleMessage(message) {
	// 忽略群组消息，只处理私聊
	const chat = await message.getChat();
	if (chat.isGroup) return;

	const phone = message.from;
	const messages = _getMessages();
	const session = getOrCreateSession(phone);

	logger.debug('收到消息', {
		phone,
		type: message.type,
		state: session.state,
		body: message.body?.slice(0, 50),
	});

	try {
		// 根据会话状态路由
		switch (session.state) {
			case SESSION_STATE.WAITING_IC:
				// 等待注册：只接受文本
				if (message.type === 'chat') {
					await handleRegistration(message, session);
				} else {
					await message.reply(messages.registration.welcome);
				}
				break;

			case SESSION_STATE.WAITING_RECEIPT:
				// 注册完成：接受图片，文本给提示
				if (message.hasMedia && message.type === 'image') {
					await handleReceipt(message, session);
				} else if (message.type === 'chat') {
					// 用户可能重新输入 IC，检测关键词重置
					if (_isResetKeyword(message.body)) {
						await message.reply(messages.registration.welcome);
					} else {
						await message.reply('请发送收据截图。如需重新注册，请回复「重新注册」。');
					}
				}
				break;

			case SESSION_STATE.DONE:
				await message.reply('您的提交已完成。如需再次提交，请回复「重新开始」。');
				break;

			default:
				await message.reply(messages.registration.welcome);
		}
	} catch (err) {
		logger.error('消息处理异常', { phone, error: err.message, stack: err.stack });
		await message.reply(messages.errors.unknown).catch(() => {});
	}
}


/**
 * 检测是否是重置流程的关键词
 */
function _isResetKeyword(text) {
	if (!text) return false;
	const keywords = ['重新注册', '重新开始', 'restart', 'reset', 'start'];
	return keywords.some(kw => text.toLowerCase().includes(kw.toLowerCase()));
}


module.exports = { handleMessage };
