import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/auth.routes.js';
import { ReplayService } from './replay.service.js';

export async function registerReplayRoutes(app: FastifyInstance) {
  const replay = new ReplayService();

  app.get('/api/replays/:gameId', async (request) => {
    await requireAuth(request);
    const { gameId } = z.object({ gameId: z.string() }).parse(request.params);
    return { steps: await replay.getReplay(gameId) };
  });
}
