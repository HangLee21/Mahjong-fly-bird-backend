import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError } from '../common/errors.js';
import { signAuthToken, verifyAuthToken } from './jwt.js';
import { AuthService } from './auth.service.js';
import { UserService } from '../users/user.service.js';

const LoginBody = z.object({
  code: z.string().min(1),
  nickname: z.string().optional(),
  avatarUrl: z.string().optional()
});

export function getBearerToken(request: FastifyRequest) {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw new AppError('UNAUTHORIZED', 'Missing bearer token.', 401);
  return header.slice('Bearer '.length);
}

export async function requireAuth(request: FastifyRequest) {
  return verifyAuthToken(getBearerToken(request));
}

export async function registerAuthRoutes(app: FastifyInstance) {
  const auth = new AuthService();
  const users = new UserService();

  app.post('/api/auth/wechat-login', async (request) => {
    return auth.wechatLogin(LoginBody.parse(request.body));
  });

  app.post('/api/auth/refresh', async (request) => {
    const payload = await requireAuth(request);
    return { token: signAuthToken(payload), userId: payload.userId };
  });

  app.get('/api/auth/me', async (request) => {
    const payload = await requireAuth(request);
    const user = await users.getUser(payload.userId);
    if (!user) throw new AppError('UNAUTHORIZED', 'User not found.', 401);
    return { user };
  });
}
