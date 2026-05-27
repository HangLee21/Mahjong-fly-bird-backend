import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../config/env.js';
import { AppError } from '../common/errors.js';
import { ReplayService } from '../replay/replay.service.js';
import { ModelVersionService } from './model-version.service.js';

function requireAdminToken(authorization?: string) {
  if (authorization !== `Bearer ${env.ADMIN_TOKEN}`) {
    throw new AppError('UNAUTHORIZED', 'Invalid admin token.', 401);
  }
}

export async function registerAdminRoutes(app: FastifyInstance) {
  const replay = new ReplayService();
  const models = new ModelVersionService();

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
}
