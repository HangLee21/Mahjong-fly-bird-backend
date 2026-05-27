import type { GameState } from '../game/game.state.js';
import { redis } from './redis.js';

export interface RoomStateStore {
  get(roomId: string): Promise<GameState | null>;
  set(roomId: string, state: GameState): Promise<void>;
  delete(roomId: string): Promise<void>;
}

export class RedisRoomStateStore implements RoomStateStore {
  async get(roomId: string) {
    const raw = await redis.get(`room:${roomId}:state`);
    return raw ? (JSON.parse(raw) as GameState) : null;
  }

  async set(roomId: string, state: GameState) {
    await redis.set(`room:${roomId}:state`, JSON.stringify(state));
  }

  async delete(roomId: string) {
    await redis.del(`room:${roomId}:state`);
  }
}

export class MemoryRoomStateStore implements RoomStateStore {
  private states = new Map<string, GameState>();

  async get(roomId: string) {
    return this.states.get(roomId) ?? null;
  }

  async set(roomId: string, state: GameState) {
    this.states.set(roomId, structuredClone(state));
  }

  async delete(roomId: string) {
    this.states.delete(roomId);
  }
}

export const roomStateStore: RoomStateStore = new RedisRoomStateStore();
