import type { FastifyInstance } from 'fastify';
import { env } from '../config/env.js';

export async function registerAppConfigRoutes(app: FastifyInstance) {
  app.get('/api/app/bootstrap', async (request) => {
    const forwardedHost = firstHeader(request.headers['x-forwarded-host']);
    const forwardedProto = firstHeader(request.headers['x-forwarded-proto']);
    const host = forwardedHost ?? request.headers.host ?? `localhost:${env.PORT}`;
    const secure = forwardedProto === 'https' || (!forwardedProto && request.protocol === 'https');
    const httpProtocol = secure ? 'https' : 'http';
    const wsProtocol = secure ? 'wss' : 'ws';
    return {
      serverTime: Date.now(),
      maintenance: false,
      minClientVersion: '0.1.0',
      rulePreset: env.DEFAULT_RULE_VERSION,
      assetVersion: new Date().toISOString().slice(0, 10).replace(/-/g, '.'),
      apiBaseUrl: `${httpProtocol}://${host}/api`,
      wsUrl: `${wsProtocol}://${host}/ws`,
      assetBaseUrl: `${httpProtocol}://${host}/game-assets/`,
      notice: '欢迎体验曲靖飞小鸡'
    };
  });
}

function firstHeader(value: string | string[] | undefined) {
  const first = Array.isArray(value) ? value[0] : value;
  return first?.split(',')[0]?.trim().toLowerCase();
}
