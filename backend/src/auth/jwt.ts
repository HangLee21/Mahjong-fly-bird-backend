import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { AppError } from '../common/errors.js';

export interface AuthTokenPayload {
  userId: string;
  openid: string;
}

export function signAuthToken(payload: AuthTokenPayload) {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN } as jwt.SignOptions);
}

export function verifyAuthToken(token: string): AuthTokenPayload {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as AuthTokenPayload;
    return { userId: decoded.userId, openid: decoded.openid };
  } catch {
    throw new AppError('UNAUTHORIZED', 'Invalid token.', 401);
  }
}
