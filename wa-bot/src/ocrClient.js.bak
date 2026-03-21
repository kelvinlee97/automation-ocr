/**
 * OCR 服务 HTTP 客户端
 * 封装与 Python FastAPI 服务的通信，含超时和重试逻辑
 */

const axios = require('axios');
const logger = require('./utils/logger');

let _config = null;

function _getConfig() {
	if (!_config) {
		const yaml = require('js-yaml');
		const fs = require('fs');
		const path = require('path');
		_config = yaml.load(fs.readFileSync(
			path.join(__dirname, '../../config/config.yaml'), 'utf8'
		));
	}
	return _config;
}


/**
 * 调用 OCR 服务处理收据图片
 * @param {{ imageBase64: string, phone: string, icNumber?: string }} params
 * @returns {Promise<import('../src/models/receipt').ReceiptProcessResult>}
 */
async function processReceipt({ imageBase64, phone, icNumber = null }) {
	const config = _getConfig();
	// 环境变量优先（Docker 部署时注入），兜底读 config.yaml
	const baseUrl = process.env.OCR_SERVICE_URL || config.services.ocr_service_url;
	const timeoutMs = config.bot.ocr_timeout_seconds * 1000;
	const maxRetries = config.bot.ocr_max_retries;

	// 构建请求体，ic_number 仅在有值时才传
	const requestBody = { image_base64: imageBase64, phone };
	if (icNumber) {
		requestBody.ic_number = icNumber;
	}

	return _requestWithRetry(
		() => axios.post(
			`${baseUrl}/ocr/receipt`,
			requestBody,
			{ timeout: timeoutMs }
		),
		maxRetries,
		'processReceipt'
	);
}


/**
 * 调用注册接口，写入 Excel
 * @param {{ phone: string, icNumber: string }} params
 */
async function registerUser({ phone, icNumber }) {
	const config = _getConfig();
	// 环境变量优先（Docker 部署时注入），兜底读 config.yaml
	const baseUrl = process.env.OCR_SERVICE_URL || config.services.ocr_service_url;
	const timeoutMs = config.bot.ocr_timeout_seconds * 1000;
	const maxRetries = config.bot.ocr_max_retries;

	return _requestWithRetry(
		() => axios.post(
			`${baseUrl}/data/register`,
			{ phone, ic_number: icNumber },
			{ timeout: timeoutMs }
		),
		maxRetries,
		'registerUser'
	);
}


/**
 * 探测 OCR 服务是否可用
 */
async function healthCheck() {
	const config = _getConfig();
	// 环境变量优先（Docker 部署时注入），兜底读 config.yaml
	const baseUrl = process.env.OCR_SERVICE_URL || config.services.ocr_service_url;
	try {
		const response = await axios.get(
			`${baseUrl}/health`,
			{ timeout: 5000 }
		);
		return response.status === 200;
	} catch {
		return false;
	}
}


/**
 * 带指数退避的重试请求
 * 第 n 次重试等待 2^n * 500ms，最大等待 8 秒
 */
async function _requestWithRetry(requestFn, maxRetries, label) {
	let lastError;

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			const response = await requestFn();
			return response.data;
		} catch (err) {
			lastError = err;
			const isRetryable = !err.response || err.response.status >= 500;

			if (!isRetryable || attempt === maxRetries) {
				break;
			}

			const waitMs = Math.min(500 * Math.pow(2, attempt), 8000);
			logger.warn(`${label} 第 ${attempt + 1} 次失败，${waitMs}ms 后重试`, {
				error: err.message,
			});
			await _sleep(waitMs);
		}
	}

	logger.error(`${label} 达到最大重试次数`, { error: lastError.message });
	throw lastError;
}


function _sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}


module.exports = { processReceipt, registerUser, healthCheck };
