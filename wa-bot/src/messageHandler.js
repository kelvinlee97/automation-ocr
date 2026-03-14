/**
 * 消息路由分发器
 * 收到图片 → 静默 OCR 处理（不回复）
 * 收到其他消息 → 忽略
 */

const { handleReceipt } = require('./handlers/receiptHandler');
const logger = require('./utils/logger');


/**
 * 主消息处理入口
 * @param {import('whatsapp-web.js').Message} message
 */
async function handleMessage(message) {
	// 忽略群组消息，只处理私聊
	const chat = await message.getChat();
	if (chat.isGroup) return;

	const phone = message.from;

	logger.debug('收到消息', {
		phone,
		type: message.type,
		body: message.body?.slice(0, 50),
	});

	try {
		if (message.hasMedia && message.type === 'image') {
			// 图片消息 → 静默 OCR 处理
			await handleReceipt(message, phone);
		}
		// 非图片消息（文本、语音等）→ 静默忽略
	} catch (err) {
		logger.error('消息处理异常', { phone, error: err.message, stack: err.stack });
	}
}


module.exports = { handleMessage };
