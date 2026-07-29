import { Redis } from 'ioredis';
import { logger } from '../common/logger.js';
import { env } from '../config/env.js';

export const redis = new Redis(env.REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  retryStrategy(times) {
    return Math.min(times * 500, 5000);
  }
});

redis.on('error', (error) => {
  logger.warn({ error }, 'Redis connection error');
});

export async function connectRedis() {
  if (redis.status === 'end' || redis.status === 'wait') {
    await redis.connect();
  }
}
