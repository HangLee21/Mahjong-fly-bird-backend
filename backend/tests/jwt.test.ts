import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { AppError } from '../src/common/errors.js';
import { env } from '../src/config/env.js';
import { signAuthToken, verifyAuthToken } from '../src/auth/jwt.js';

describe('auth token versioning', () => {
  it('accepts a token issued with the current auth version', () => {
    const token = signAuthToken({ userId: 'user-1', openid: 'openid-1' });

    expect(verifyAuthToken(token)).toEqual({ userId: 'user-1', openid: 'openid-1' });
  });

  it('rejects a legacy token without an auth version claim', () => {
    const token = jwt.sign(
      { userId: 'user-1', openid: 'openid-1' },
      env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    expect(() => verifyAuthToken(token)).toThrowError(AppError);
    try {
      verifyAuthToken(token);
    } catch (error) {
      expect(error).toMatchObject({ code: 'UNAUTHORIZED', statusCode: 401 });
    }
  });

  it('rejects a token issued for another auth version', () => {
    const token = jwt.sign(
      { userId: 'user-1', openid: 'openid-1', authVersion: 'retired-version' },
      env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    expect(() => verifyAuthToken(token)).toThrowError(AppError);
  });
});
