import { randomUUID } from 'node:crypto';
import { AppError } from '../common/errors.js';
import { redis } from './redis.js';

export interface LockManager {
  withRoomLock<T>(roomId: string, fn: () => Promise<T>): Promise<T>;
}

export class RedisLockManager implements LockManager {
  async withRoomLock<T>(roomId: string, fn: () => Promise<T>): Promise<T> {
    const key = `room:${roomId}:lock`;
    const token = randomUUID();
    const acquired = await redis.set(key, token, 'PX', 3000, 'NX');
    if (!acquired) throw new AppError('STATE_VERSION_CONFLICT', 'Room state is locked.', 409);

    try {
      return await fn();
    } finally {
      const current = await redis.get(key);
      if (current === token) await redis.del(key);
    }
  }
}

export class MemoryLockManager implements LockManager {
  private locked = new Set<string>();

  async withRoomLock<T>(roomId: string, fn: () => Promise<T>): Promise<T> {
    if (this.locked.has(roomId)) throw new AppError('STATE_VERSION_CONFLICT', 'Room state is locked.', 409);
    this.locked.add(roomId);
    try {
      return await fn();
    } finally {
      this.locked.delete(roomId);
    }
  }
}

export const lockManager: LockManager = new RedisLockManager();
