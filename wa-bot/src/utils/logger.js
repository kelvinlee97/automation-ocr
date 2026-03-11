/**
 * 日志模块
 * 使用 winston 同时输出到控制台和文件
 */
const winston = require('winston');
const path = require('path');

const LOG_DIR = path.join(__dirname, '../../../logs');

const logger = winston.createLogger({
	level: process.env.LOG_LEVEL || 'info',
	format: winston.format.combine(
		winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
		winston.format.errors({ stack: true }),
		winston.format.json()
	),
	transports: [
		// 控制台输出（彩色，便于开发调试）
		new winston.transports.Console({
			format: winston.format.combine(
				winston.format.colorize(),
				winston.format.printf(({ timestamp, level, message, ...meta }) => {
					const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
					return `${timestamp} [${level}]: ${message}${metaStr}`;
				})
			)
		}),
		// 文件输出（结构化 JSON，便于生产环境查询）
		new winston.transports.File({
			filename: path.join(LOG_DIR, 'wa-bot.log'),
			maxsize: 10 * 1024 * 1024,  // 单文件最大 10MB
			maxFiles: 5,                  // 保留最近 5 个文件
		}),
	],
});

module.exports = logger;
