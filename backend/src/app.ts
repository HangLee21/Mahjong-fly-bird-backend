import cors from '@fastify/cors';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import { registerAdminRoutes } from './admin/admin.routes.js';
import { registerAiRoutes } from './ai/ai.routes.js';
import { registerAuthRoutes } from './auth/auth.routes.js';
import { errorResponse, AppError } from './common/errors.js';
import { env } from './config/env.js';
import { registerGameRoutes } from './game/game.routes.js';
import { registerReplayRoutes } from './replay/replay.routes.js';
import { registerRoomRoutes } from './rooms/room.routes.js';

export async function buildApp() {
  const app = Fastify({ logger: { level: env.LOG_LEVEL } });
  await app.register(cors, { origin: true });

  app.get('/api/health', async () => ({ ok: true }));

  await registerAuthRoutes(app);
  await registerRoomRoutes(app);
  await registerGameRoutes(app);
  await registerAiRoutes(app);
  await registerReplayRoutes(app);
  await registerAdminRoutes(app);

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      reply.status(400).send({ code: 'ILLEGAL_ACTION', message: 'Invalid request.', details: error.flatten() });
      return;
    }
    const normalized = errorResponse(error instanceof AppError ? error : error);
    reply.status(normalized.statusCode).send(normalized.body);
  });

  return app;
}
