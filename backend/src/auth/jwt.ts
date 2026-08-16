import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { AppError } from '../common/errors.js';

export interface AuthTokenPayload {
  userId: string;
  openid: string;
}

export function signAuthToken(payload: AuthTokenPayload) {
  return jwt.sign(
    { ...payload, authVersion: env.AUTH_TOKEN_VERSION },
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN } as jwt.SignOptions
  );
}

export function verifyAuthToken(token: string): AuthTokenPayload {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as Partial<AuthTokenPayload> & { authVersion?: unknown };
    if (
      typeof decoded.userId !== 'string'
      || typeof decoded.openid !== 'string'
      || decoded.authVersion !== env.AUTH_TOKEN_VERSION
    ) {
      throw new Error('Auth token version mismatch.');
    }
    return { userId: decoded.userId, openid: decoded.openid };
  } catch {
    throw new AppError('UNAUTHORIZED', 'Invalid token.', 401);
  }
}
