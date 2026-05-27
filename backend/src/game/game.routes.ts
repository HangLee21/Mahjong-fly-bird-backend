import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/auth.routes.js';
import { ClientActionSchema } from '../rules/actions.js';
import { gameService } from './game.service.js';

export async function registerGameRoutes(app: FastifyInstance) {
  app.get('/api/rooms/:roomId/game', async (request) => {
    const auth = await requireAuth(request);
    const { roomId } = z.object({ roomId: z.string() }).parse(request.params);
    return gameService.getGameView(roomId, auth.userId);
  });

  app.post('/api/rooms/:roomId/game/actions', async (request) => {
    const auth = await requireAuth(request);
    const { roomId } = z.object({ roomId: z.string() }).parse(request.params);
    return gameService.submitAction(roomId, auth.userId, ClientActionSchema.parse(request.body));
  });
}
