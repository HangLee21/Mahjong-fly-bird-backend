import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/auth.routes.js';
import { gameService } from '../game/game.service.js';
import { defaultRoomRules, presentRoom, presentRoomPreview } from './room.presenter.js';
import { RoomService } from './room.service.js';
import { getBroadcaster } from '../websocket/ws-broadcast.js';

const AddAiBody = z.object({
  seatIndex: z.coerce.number().int().min(0).max(3).optional(),
  model: z.string().optional(),
  aiLevel: z.string().optional(),
  aiModel: z.string().optional()
});

const JoinRoomBody = z
  .object({
    seatIndex: z.number().int().min(0).max(3).optional()
  })
  .optional();

const CreateRoomBody = z
  .object({
    roomId: z.string().regex(/^\d{6}$/).optional(),
    rules: z.record(z.unknown()).optional()
  })
  .optional();

export async function registerRoomRoutes(app: FastifyInstance) {
  const rooms = new RoomService();

  app.post('/api/rooms', async (request) => {
    const auth = await requireAuth(request);
    const body = CreateRoomBody.parse(request.body ?? {});
    const room = await rooms.createRoom(auth.userId, { ...defaultRoomRules, ...(body?.rules ?? {}) }, body?.roomId);
    return { room: presentRoom(room) };
  });

  app.get('/api/rooms/:roomId', async (request) => {
    const { roomId } = z.object({ roomId: z.string() }).parse(request.params);
    return presentRoom(await rooms.getRoom(roomId));
  });

  app.get('/api/rooms/:roomId/preview', async (request) => {
    const { roomId } = z.object({ roomId: z.string() }).parse(request.params);
    return presentRoomPreview(await rooms.previewRoom(roomId), roomId);
  });

  app.post('/api/rooms/:roomId/join', async (request) => {
    const auth = await requireAuth(request);
    const { roomId } = z.object({ roomId: z.string() }).parse(request.params);
    const body = JoinRoomBody.parse(request.body ?? {});
    const room = await rooms.joinRoom(roomId, auth.userId, body?.seatIndex);
    getBroadcaster().broadcastRoom(room.id, 'ROOM_VIEW', presentRoom(room));
    return presentRoom(room);
  });

  app.post('/api/rooms/:roomId/leave', async (request) => {
    const auth = await requireAuth(request);
    const { roomId } = z.object({ roomId: z.string() }).parse(request.params);
    const result = await rooms.leaveRoom(roomId, auth.userId);
    return 'deleted' in result ? result : presentRoom(result);
  });

  app.post('/api/rooms/:roomId/add-ai', async (request) => {
    const auth = await requireAuth(request);
    const { roomId } = z.object({ roomId: z.string() }).parse(request.params);
    const body = AddAiBody.parse(request.body ?? {});
    const room = await rooms.addAi(roomId, auth.userId, { ...body, aiModel: body.aiModel ?? body.model });
    getBroadcaster().broadcastRoom(room.id, 'ROOM_VIEW', presentRoom(room));
    return presentRoom(room);
  });

  app.post('/api/rooms/:roomId/rules', async (request) => {
    const auth = await requireAuth(request);
    const { roomId } = z.object({ roomId: z.string() }).parse(request.params);
    const body = z.record(z.unknown()).parse(request.body ?? {});
    return presentRoom(await rooms.updateRules(roomId, auth.userId, body));
  });

  app.post('/api/rooms/:roomId/start', async (request) => {
    const auth = await requireAuth(request);
    const { roomId } = z.object({ roomId: z.string() }).parse(request.params);
    return gameService.startGame(roomId, auth.userId);
  });
}
