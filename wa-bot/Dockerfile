FROM node:20-slim

WORKDIR /app

# Install the system libraries required for whatsapp-web.js to embed Chromium
# This is necessary to run in a clean Ubuntu/Debian environment
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
    build-essential \
    python3 \
    && rm -rf /var/lib/apt/lists/*

# First copy package.json and use layer caching
COPY package.json package-lock.json* ./
# npm ci is installed strictly according to the lockfile to ensure that the image and development environment dependencies are consistent.
RUN npm ci --omit=dev

# Copy bot code
COPY . .

# The relative path in the code will resolve to /config/, but docker-compose is mounted at /app/config/
# Create symbolic links so that both paths can correctly access the configuration file
RUN ln -s /app/config /config

CMD ["node", "index.js"]
