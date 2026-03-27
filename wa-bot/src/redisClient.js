const Redis = require('ioredis');
const logger = require('./utils/logger');

let redis = null;
let useMemoryFallback = false;

function createClient(config) {
  const options = {
    host: config.redis.host,
    port: config.redis.port,
    retryStrategy: (times) => {
      if (times > 10) {
        logger.warn('Redis 重连次数过多，切换到内存模式');
        useMemoryFallback = true;
        return null;
      }
      return Math.min(times * 100, 3000);
    },
    maxRetriesPerRequest: 3,
    lazyConnect: true,
  };

  if (config.redis.password) {
    options.password = config.redis.password;
  }

  redis = new Redis(options);

  redis.on('connect', () => {
    logger.info('Redis 连接成功');
    useMemoryFallback = false;
  });

  redis.on('error', (err) => {
    if (!useMemoryFallback) {
      logger.warn('Redis 连接失败，切换到内存模式', { error: err.message });
      useMemoryFallback = true;
    }
  });

  redis.on('ready', () => {
    logger.info('Redis 就绪');
  });

  return redis;
}

async function connect(redisClient) {
  try {
    await redisClient.connect();
  } catch (err) {
    if (err.message !== 'Redis is already connecting/connected') {
      throw err;
    }
  }
}

function isMemoryFallback() {
  return useMemoryFallback;
}

function getClient() {
  return redis;
}

module.exports = { createClient, connect, isMemoryFallback, getClient };
