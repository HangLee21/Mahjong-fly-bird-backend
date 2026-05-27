import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/auth.routes.js';
import { gameService } from '../game/game.service.js';
import { RoomService } from './room.service.js';

const AddAiBody = z.object({
  aiLevel: z.string().optional(),
  aiModel: z.string().optional()
});

export async function registerRoomRoutes(app: FastifyInstance) {
  const rooms = new RoomService();

  app.post('/api/rooms', async (request) => {
    const auth = await requireAuth(request);
    return rooms.createRoom(auth.userId);
  });

  app.get('/api/rooms/:roomId', async (request) => {
    const { roomId } = z.object({ roomId: z.string() }).parse(request.params);
    return rooms.getRoom(roomId);
  });

  app.post('/api/rooms/:roomId/join', async (request) => {
    const auth = await requireAuth(request);
    const { roomId } = z.object({ roomId: z.string() }).parse(request.params);
    return rooms.joinRoom(roomId, auth.userId);
  });

  app.post('/api/rooms/:roomId/leave', async (request) => {
    const auth = await requireAuth(request);
    const { roomId } = z.object({ roomId: z.string() }).parse(request.params);
    return rooms.leaveRoom(roomId, auth.userId);
  });

  app.post('/api/rooms/:roomId/add-ai', async (request) => {
    const auth = await requireAuth(request);
    const { roomId } = z.object({ roomId: z.string() }).parse(request.params);
    return rooms.addAi(roomId, auth.userId, AddAiBody.parse(request.body ?? {}));
  });

  app.post('/api/rooms/:roomId/start', async (request) => {
    const auth = await requireAuth(request);
    const { roomId } = z.object({ roomId: z.string() }).parse(request.params);
    return gameService.startGame(roomId, auth.userId);
  });
}
