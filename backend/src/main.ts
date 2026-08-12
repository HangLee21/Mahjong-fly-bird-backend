import { buildApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './common/logger.js';
import { registerWebSocketServer } from './websocket/ws-server.js';
import { RoomService } from './rooms/room.service.js';

const app = await buildApp();
registerWebSocketServer(app.server);

const roomCleanup = new RoomService();
const cleanupTimer = setInterval(() => {
  void roomCleanup.cleanupExpiredRooms().catch((error) => {
    logger.warn({ error }, 'Room cleanup cycle failed');
  });
}, env.ROOM_CLEANUP_INTERVAL_MS);
cleanupTimer.unref?.();
void roomCleanup.cleanupExpiredRooms();

try {
  await app.listen({ host: env.HOST, port: env.PORT });
  logger.info({ host: env.HOST, port: env.PORT }, 'Backend started');
} catch (error) {
  logger.error(error);
  process.exit(1);
}
