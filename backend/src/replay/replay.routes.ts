import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/auth.routes.js';
import { ReplayService } from './replay.service.js';

export async function registerReplayRoutes(app: FastifyInstance) {
  const replay = new ReplayService();

  app.get('/api/replays', async (request) => {
    const auth = await requireAuth(request);
    return replay.listReplays(auth.userId);
  });

  app.get('/api/replays/:gameId', async (request) => {
    await requireAuth(request);
    const { gameId } = z.object({ gameId: z.string() }).parse(request.params);
    return replay.getReplayRecord(gameId);
  });
}
