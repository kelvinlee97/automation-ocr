FROM node:18-slim

WORKDIR /app

# 安装 whatsapp-web.js 内嵌 Chromium 所需的系统库
# 这是在干净 Ubuntu/Debian 环境中运行的必要条件
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgbm-dev \
    libasound2 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libpango-1.0-0 \
    libcairo2 \
    libnss3 \
    && rm -rf /var/lib/apt/lists/*

# 先复制 package.json，利用 layer 缓存
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# 复制 bot 代码
COPY . .

# 代码中相对路径会解析到 /config/，但 docker-compose 挂载在 /app/config/
# 创建符号链接让两条路径都能正确访问配置文件
RUN ln -s /app/config /config

CMD ["node", "index.js"]
