/**
 * Log module
 * Use winston to output to console and file simultaneously
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
		// Console output (color, convenient for development and debugging)
		new winston.transports.Console({
			format: winston.format.combine(
				winston.format.colorize(),
				winston.format.printf(({ timestamp, level, message, ...meta }) => {
					const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
					return `${timestamp} [${level}]: ${message}${metaStr}`;
				})
			)
		}),
		// File output (structured JSON, convenient for production environment query)
		new winston.transports.File({
			filename: path.join(LOG_DIR, 'wa-bot.log'),
			maxsize: 10 * 1024 * 1024,  // Maximum single file size 10MB
			maxFiles: 5,                  // Keep last 5 files
		}),
	],
});

module.exports = logger;
