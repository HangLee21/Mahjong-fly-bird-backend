import { AppError } from '../common/errors.js';
import { verifyAuthToken } from '../auth/jwt.js';

export function authFromWsUrl(url: string | undefined) {
  const parsed = new URL(url ?? '/', 'http://localhost');
  const token = parsed.searchParams.get('token');
  if (!token) throw new AppError('UNAUTHORIZED', 'Missing token.', 401);
  return verifyAuthToken(token);
}
