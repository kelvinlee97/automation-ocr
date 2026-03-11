/**
 * 收据处理器
 * 下载图片 → base64 → OCR → 格式化回复
 */

const { processReceipt } = require('../ocrClient');
const { checkReceiptLimit, incrementReceiptCount } = require('../sessionManager');
const logger = require('../utils/logger');

let _messages = null;
let _config = null;

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

function _getConfig() {
	if (!_config) {
		const yaml = require('js-yaml');
		const fs = require('fs');
		const path = require('path');
		_config = yaml.load(fs.readFileSync(
			path.join(__dirname, '../../../config/config.yaml'), 'utf8'
		));
	}
	return _config;
}


/**
 * 处理用户发送的收据图片
 * @param {import('whatsapp-web.js').Message} message
 * @param {object} session
 */
async function handleReceipt(message, session) {
	const messages = _getMessages();
	const config = _getConfig();

	// 检查每日提交上限
	const limitCheck = checkReceiptLimit(session.phone);
	if (!limitCheck.allowed) {
		const reply = messages.receipt.daily_limit_exceeded
			.replace('{max}', config.bot.max_receipts_per_day);
		await message.reply(reply);
		return;
	}

	// 提示用户等待处理
	await message.reply(messages.receipt.processing);

	// 下载图片并转为 base64
	let imageBase64;
	try {
		imageBase64 = await _downloadMessageMedia(message);
	} catch (err) {
		logger.error('图片下载失败', { phone: session.phone, error: err.message });
		await message.reply(messages.receipt.ocr_failed);
		return;
	}

	// 调用 OCR 服务
	let result;
	try {
		result = await processReceipt({
			imageBase64,
			phone: session.phone,
			icNumber: session.ic,
		});
	} catch (err) {
		logger.error('OCR 服务调用失败', { phone: session.phone, error: err.message });
		await message.reply(messages.errors.service_unavailable);
		return;
	}

	// OCR 服务内部失败（非网络错误）
	if (!result.success) {
		logger.warn('OCR 处理失败', { phone: session.phone, error: result.error });
		await message.reply(messages.receipt.ocr_failed);
		return;
	}

	// 更新提交计数
	incrementReceiptCount(session.phone);

	// 格式化回复
	const reply = _formatReceiptReply(result, messages);
	await message.reply(reply);

	logger.info('收据处理完成', {
		phone: session.phone,
		qualified: result.qualified,
		brand: result.brand,
		amount: result.amount,
	});
}


/**
 * 下载 WhatsApp 图片消息并返回 base64 字符串
 */
async function _downloadMessageMedia(message) {
	if (!message.hasMedia) {
		throw new Error('消息不含媒体文件');
	}

	const media = await message.downloadMedia();
	if (!media || !media.data) {
		throw new Error('媒体文件下载失败');
	}

	return media.data; // whatsapp-web.js 返回的 data 已是 base64
}


/**
 * 根据 OCR 结果生成用户回复文本
 */
function _formatReceiptReply(result, messages) {
	if (result.qualified) {
		return messages.receipt.qualified
			.replace('{receipt_no}', result.receipt_no || '未识别')
			.replace('{brand}', result.brand || '未识别')
			.replace('{amount}', result.amount ? result.amount.toFixed(2) : '未识别');
	}

	return messages.receipt.not_qualified
		.replace('{reason}', result.disqualify_reason || '未知原因');
}


module.exports = { handleReceipt };
