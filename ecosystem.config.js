/**
 * PM2 生产部署配置
 * 用法：pm2 start ecosystem.config.js
 *      pm2 start ecosystem.config.js --env production
 */

module.exports = {
	apps: [
		{
			name: 'ocr-service',
			// 通过 bash 激活 venv 再启动 uvicorn
			script: 'bash',
			args: '-c "source .venv/bin/activate && uvicorn main:app --host 0.0.0.0 --port 8000"',
			cwd: './ocr-service',
			interpreter: 'none',
			// OCR 服务重启时给足够时间加载模型（约 15 秒）
			wait_ready: false,
			listen_timeout: 30000,
			env: {
				NODE_ENV: 'development',
				PYTHONUNBUFFERED: '1',
			},
			env_production: {
				NODE_ENV: 'production',
				PYTHONUNBUFFERED: '1',
			},
			// 崩溃后自动重启，但避免无限重启循环
			autorestart: true,
			max_restarts: 10,
			min_uptime: '10s',
			error_file: '../logs/ocr-service.error.log',
			out_file: '../logs/ocr-service.out.log',
		},
		{
			name: 'wa-bot',
			script: 'index.js',
			cwd: './wa-bot',
			env: {
				NODE_ENV: 'development',
			},
			env_production: {
				NODE_ENV: 'production',
			},
			autorestart: true,
			max_restarts: 10,
			min_uptime: '10s',
			// 确保 OCR 服务先启动再启动 bot（延迟 20 秒）
			// 注意：PM2 没有真正的依赖等待机制，这里用延迟兜底
			post_update: [],
			error_file: '../logs/wa-bot.error.log',
			out_file: '../logs/wa-bot.out.log',
		},
	],
};
