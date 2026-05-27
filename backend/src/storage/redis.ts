import { Redis } from 'ioredis';
import { env } from '../config/env.js';

export const redis = new Redis(env.REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 1
});

export async function connectRedis() {
  if (redis.status === 'end' || redis.status === 'wait') {
    await redis.connect();
  }
}
