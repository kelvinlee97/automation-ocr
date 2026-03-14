/**
 * 收据处理器（静默模式）
 * 下载图片 → base64 → OCR → 写 Excel，全程不回复用户
 */

const { processReceipt } = require('../ocrClient');
const logger = require('../utils/logger');


/**
 * 处理用户发送的收据图片（静默，不回复任何消息）
 * @param {import('whatsapp-web.js').Message} message
 * @param {string} phone - 用户手机号
 */
async function handleReceipt(message, phone) {
	// 下载图片并转为 base64
	let imageBase64;
	try {
		imageBase64 = await _downloadMessageMedia(message);
	} catch (err) {
		logger.error('图片下载失败', { phone, error: err.message });
		return;
	}

	// 调用 OCR 服务
	let result;
	try {
		result = await processReceipt({ imageBase64, phone });
	} catch (err) {
		logger.error('OCR 服务调用失败', { phone, error: err.message });
		return;
	}

	// OCR 服务内部失败（非网络错误）
	if (!result.success) {
		logger.warn('OCR 处理失败', { phone, error: result.error });
		return;
	}

	logger.info('收据处理完成', {
		phone,
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


module.exports = { handleReceipt };
