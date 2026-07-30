import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { registerAppConfigRoutes } from '../src/app-config/app-config.routes.js';

const apps: ReturnType<typeof Fastify>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('app bootstrap public URLs', () => {
  it('returns HTTPS, WSS and asset URLs from reverse-proxy headers', async () => {
    const app = Fastify();
    apps.push(app);
    await registerAppConfigRoutes(app);

    const response = await app.inject({
      method: 'GET',
      url: '/api/app/bootstrap',
      headers: {
        'x-forwarded-host': 'game-api.example.com',
        'x-forwarded-proto': 'https'
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      apiBaseUrl: 'https://game-api.example.com/api',
      wsUrl: 'wss://game-api.example.com/ws',
      assetBaseUrl: 'https://game-api.example.com/game-assets/'
    });
  });
});
