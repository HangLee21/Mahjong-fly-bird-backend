import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/auth.routes.js';
import { buildObservation } from './observation.builder.js';
import { roomStateStore } from '../storage/room-state-store.js';
import { AppError } from '../common/errors.js';

export async function registerAiRoutes(app: FastifyInstance) {
  app.get('/api/ai/observation/:roomId/:playerIndex', async (request) => {
    await requireAuth(request);
    const params = z.object({ roomId: z.string(), playerIndex: z.coerce.number().int() }).parse(request.params);
    const state = await roomStateStore.get(params.roomId);
    if (!state) throw new AppError('GAME_NOT_FOUND', 'Game not found.', 404);
    return { observation: buildObservation(state, params.playerIndex) };
  });
}
