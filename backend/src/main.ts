import { buildApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './common/logger.js';
import { registerWebSocketServer } from './websocket/ws-server.js';

const app = await buildApp();
registerWebSocketServer(app.server);

try {
  await app.listen({ host: env.HOST, port: env.PORT });
  logger.info({ host: env.HOST, port: env.PORT }, 'Backend started');
} catch (error) {
  logger.error(error);
  process.exit(1);
}
