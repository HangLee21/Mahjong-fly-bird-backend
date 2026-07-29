import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../config/env.js';
import { AppError } from '../common/errors.js';
import { ReplayService } from '../replay/replay.service.js';
import { RoomRepository } from '../rooms/room.repository.js';
import { roomStateStore } from '../storage/room-state-store.js';
import { ModelVersionService } from './model-version.service.js';

function requireAdminToken(authorization?: string) {
  if (authorization !== `Bearer ${env.ADMIN_TOKEN}`) {
    throw new AppError('UNAUTHORIZED', 'Invalid admin token.', 401);
  }
}

export async function registerAdminRoutes(app: FastifyInstance) {
  const replay = new ReplayService();
  const models = new ModelVersionService();
  const rooms = new RoomRepository();

  app.get('/api/admin/games/export', async (request, reply) => {
    requireAdminToken(request.headers.authorization);
    const query = z.object({ from: z.string(), to: z.string() }).parse(request.query);
    const jsonl = await replay.exportJsonl(new Date(query.from), new Date(query.to));
    reply.type('application/x-ndjson');
    return jsonl;
  });

  app.get('/api/admin/models', async (request) => {
    requireAdminToken(request.headers.authorization);
    return { models: await models.list() };
  });

  app.delete('/api/admin/rooms/:roomId', async (request) => {
    requireAdminToken(request.headers.authorization);
    const { roomId } = z.object({ roomId: z.string() }).parse(request.params);
    const room = await rooms.findByIdOrCode(roomId);
    if (!room) return { deleted: false, roomId };
    await roomStateStore.delete(room.id);
    await rooms.deleteRoom(room.id);
    return { deleted: true, roomId: room.roomCode, internalRoomId: room.id };
  });

  app.post('/api/admin/rooms/cleanup', async (request) => {
    requireAdminToken(request.headers.authorization);
    const body = z
      .object({
        status: z.enum(['WAITING', 'FINISHED', 'PLAYING']).default('WAITING'),
        olderThanMinutes: z.coerce.number().int().min(0).default(0)
      })
      .parse(request.body ?? {});
    const cutoff = new Date(Date.now() - body.olderThanMinutes * 60_000);
    const staleRooms = await rooms.findMany({ status: body.status, updatedBefore: cutoff });
    for (const room of staleRooms) {
      await roomStateStore.delete(room.id);
      await rooms.deleteRoom(room.id);
    }
    return {
      deletedCount: staleRooms.length,
      rooms: staleRooms.map((room) => ({ roomId: room.roomCode, internalRoomId: room.id, status: room.status }))
    };
  });
}
