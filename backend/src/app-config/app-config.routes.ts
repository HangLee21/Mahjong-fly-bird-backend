import type { FastifyInstance } from 'fastify';
import { env } from '../config/env.js';

export async function registerAppConfigRoutes(app: FastifyInstance) {
  app.get('/api/app/bootstrap', async (request) => {
    const host = request.headers.host ?? `localhost:${env.PORT}`;
    return {
      serverTime: Date.now(),
      maintenance: false,
      minClientVersion: '0.1.0',
      rulePreset: env.DEFAULT_RULE_VERSION,
      assetVersion: new Date().toISOString().slice(0, 10).replace(/-/g, '.'),
      wsUrl: `ws://${host}/ws`,
      notice: '欢迎体验曲靖飞小鸡'
    };
  });
}
