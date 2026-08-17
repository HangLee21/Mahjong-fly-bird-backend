import { AppError } from '../common/errors.js';
import { logger } from '../common/logger.js';
import { env } from '../config/env.js';
import { lockManager, type LockManager } from '../storage/locks.js';
import { roomStateStore, type RoomStateStore } from '../storage/room-state-store.js';
import { getBroadcaster } from '../websocket/ws-broadcast.js';
import { presentRoom } from './room.presenter.js';
import { RoomRepository } from './room.repository.js';

export class RoomService {
  constructor(
    private readonly rooms = new RoomRepository(),
    private readonly stateStore: RoomStateStore = roomStateStore,
    private readonly locks: LockManager = lockManager
  ) {}

  async createRoom(ownerId: string, config: Record<string, unknown> = { maxPlayers: 4, allowAi: true }, roomId?: string) {
    const roomCode = roomId?.trim();
    if (roomCode && !/^\d{6}$/.test(roomCode)) {
      throw new AppError('ILLEGAL_ACTION', 'roomId must be a 6 digit room code.');
    }
    if (roomCode && (await this.rooms.findByIdOrCode(roomCode))) {
      throw new AppError('ILLEGAL_ACTION', 'Room code already exists.');
    }
    return this.rooms.create(ownerId, config, roomCode);
  }

  async getRoom(roomId: string) {
    const room = await this.rooms.findByIdOrCode(roomId);
    if (!room) throw new AppError('ROOM_NOT_FOUND', 'Room not found.', 404);
    return room;
  }

  async previewRoom(roomId: string) {
    return this.rooms.findByIdOrCode(roomId);
  }

  async activeGameId(roomId: string) {
    return this.rooms.findActiveGameId(roomId);
  }

  async joinRoom(roomId: string, userId: string, seatIndex?: number) {
    const target = await this.getRoom(roomId);
    return this.locks.withRoomLock(target.id, async () => {
      const room = await this.getRoom(target.id);
      if (room.status !== 'WAITING') throw new AppError('GAME_ALREADY_STARTED', 'Game already started.');
      if (room.seats.some((seat) => seat.userId === userId)) return room;
      const updated = await this.rooms.join(room.id, userId, seatIndex);
      if (!updated) throw new AppError('ROOM_FULL', 'Room is full.');
      return updated;
    });
  }

  async leaveRoom(roomId: string, userId: string) {
    const target = await this.getRoom(roomId);
    return this.locks.withRoomLock(target.id, async () => {
      const result = await this.rooms.leaveAndDestroyIfEmpty(target.id, userId);
      if (result.kind === 'not_found') throw new AppError('ROOM_NOT_FOUND', 'Room not found.', 404);
      if (result.kind === 'not_joined') throw new AppError('ROOM_NOT_JOINED', 'User is not in room.');

      if (result.kind === 'deleted') {
        try {
          await this.stateStore.delete(target.id);
        } catch (error) {
          logger.warn({ error, roomId: target.id }, 'Room was deleted from the database but Redis state cleanup failed');
        }
        getBroadcaster().broadcastRoom(target.id, 'GAME_EVENT', {
          event: 'ROOM_CLOSED',
          roomId: target.roomCode
        });
        return { deleted: true, roomId: result.roomId, internalRoomId: result.internalRoomId } as const;
      }
      getBroadcaster().broadcastRoom(target.id, 'ROOM_VIEW', presentRoom(result.room));
      return result.room;
    });
  }

  async addAi(roomId: string, userId: string, input: { seatIndex?: number; aiLevel?: string; aiModel?: string }) {
    const target = await this.getRoom(roomId);
    return this.locks.withRoomLock(target.id, async () => {
      const room = await this.getRoom(target.id);
      if (room.ownerId !== userId) {
        throw new AppError('FORBIDDEN', 'Only the room owner can add AI.', 403);
      }
      if (room.status !== 'WAITING') throw new AppError('GAME_ALREADY_STARTED', 'Game already started.');
      if (!room.seats.some((seat) => seat.status === 'EMPTY')) return room;
      const updated = await this.rooms.addAi(room.id, input.aiLevel, input.aiModel, input.seatIndex);
      if (!updated) throw new AppError('ROOM_FULL', 'Room is full.');
      return updated;
    });
  }

  async setReady(roomId: string, userId: string, ready: boolean) {
    const target = await this.getRoom(roomId);
    return this.locks.withRoomLock(target.id, async () => {
      const room = await this.getRoom(target.id);
      if (room.status !== 'WAITING') throw new AppError('GAME_ALREADY_STARTED', 'Game already started.');
      if (!room.seats.some((seat) => seat.userId === userId && !seat.isAI)) {
        throw new AppError('ROOM_NOT_JOINED', 'User is not in room.', 403);
      }
      const updated = await this.rooms.setReady(room.id, userId, ready);
      if (!updated) throw new AppError('ROOM_NOT_JOINED', 'User is not in room.', 403);
      getBroadcaster().broadcastRoom(updated.id, 'ROOM_VIEW', presentRoom(updated));
      return updated;
    });
  }

  async removeAi(roomId: string, userId: string, seatIndex?: number) {
    const target = await this.getRoom(roomId);
    return this.locks.withRoomLock(target.id, async () => {
      const room = await this.getRoom(target.id);
      if (room.ownerId !== userId) {
        throw new AppError('FORBIDDEN', 'Only the room owner can remove AI.', 403);
      }
      if (room.status !== 'WAITING') throw new AppError('GAME_ALREADY_STARTED', 'Game already started.');
      const updated = await this.rooms.removeAi(room.id, seatIndex);
      if (!updated) throw new AppError('ROOM_FULL', 'No AI seat to remove.');
      getBroadcaster().broadcastRoom(updated.id, 'ROOM_VIEW', presentRoom(updated));
      return updated;
    });
  }

  async kickPlayer(roomId: string, userId: string, seatIndex: number) {
    const target = await this.getRoom(roomId);
    return this.locks.withRoomLock(target.id, async () => {
      const room = await this.getRoom(target.id);
      if (room.ownerId !== userId) {
        throw new AppError('FORBIDDEN', 'Only the room owner can kick players.', 403);
      }
      if (room.status !== 'WAITING') throw new AppError('GAME_ALREADY_STARTED', 'Game already started.');
      const seat = room.seats.find((item) => item.seatIndex === seatIndex);
      if (!seat?.userId || seat.isAI) {
        throw new AppError('ROOM_NOT_JOINED', 'Target seat is not a human player.', 400);
      }
      if (seat.userId === userId) {
        throw new AppError('FORBIDDEN', 'Room owner cannot kick themselves.', 400);
      }
      const updated = await this.rooms.kickPlayer(room.id, seatIndex);
      if (!updated) throw new AppError('ROOM_NOT_JOINED', 'Target seat is not a human player.', 400);
      getBroadcaster().broadcastRoom(updated.id, 'ROOM_VIEW', presentRoom(updated));
      return updated;
    });
  }

  async transferOwner(roomId: string, userId: string, seatIndex: number) {
    const target = await this.getRoom(roomId);
    return this.locks.withRoomLock(target.id, async () => {
      const room = await this.getRoom(target.id);
      if (room.ownerId !== userId) {
        throw new AppError('FORBIDDEN', 'Only the room owner can transfer ownership.', 403);
      }
      if (room.status !== 'WAITING') throw new AppError('GAME_ALREADY_STARTED', 'Game already started.');
      const seat = room.seats.find((item) => item.seatIndex === seatIndex);
      if (!seat?.userId || seat.isAI) {
        throw new AppError('ROOM_NOT_JOINED', 'Target seat is not a human player.', 400);
      }
      if (seat.userId === userId) throw new AppError('FORBIDDEN', 'Room owner cannot transfer to themselves.', 400);
      const updated = await this.rooms.transferOwner(room.id, seat.userId);
      if (!updated) throw new AppError('ROOM_NOT_JOINED', 'Target seat is not a human player.', 400);
      getBroadcaster().broadcastRoom(updated.id, 'ROOM_VIEW', presentRoom(updated));
      return updated;
    });
  }

  async updateRules(roomId: string, userId: string, rules: Record<string, unknown>) {
    const target = await this.getRoom(roomId);
    return this.locks.withRoomLock(target.id, async () => {
      const room = await this.getRoom(target.id);
      if (room.ownerId !== userId) {
        throw new AppError('FORBIDDEN', 'Only the room owner can change rules.', 403);
      }
      if (room.status !== 'WAITING') {
        throw new AppError('GAME_ALREADY_STARTED', 'Rules can only be changed before the game starts.');
      }
      const config = {
        ...(typeof room.configJson === 'object' && room.configJson !== null ? room.configJson : {}),
        ...rules
      };
      const updated = await this.rooms.updateConfig(room.id, config);
      getBroadcaster().broadcastRoom(updated.id, 'ROOM_VIEW', presentRoom(updated));
      return updated;
    });
  }

  /**
   * Deletes rooms that are no longer useful so created room codes do not
   * occupy storage forever: finished rooms expire after ROOM_FINISHED_TTL_MS
   * and inactive (abandoned) rooms after ROOM_ABANDONED_TTL_MS.
   */
  async cleanupExpiredRooms(): Promise<number> {
    const now = Date.now();
    const finishedBefore = new Date(now - env.ROOM_FINISHED_TTL_MS);
    const inactiveBefore = new Date(now - env.ROOM_ABANDONED_TTL_MS);
    const rooms = await this.rooms.findMany({});
    let deleted = 0;

    for (const room of rooms) {
      const expired =
        (room.status === 'FINISHED' && room.updatedAt <= finishedBefore) ||
        ((room.status === 'WAITING' || room.status === 'PLAYING') && room.updatedAt <= inactiveBefore);
      if (!expired) continue;

      try {
        await this.locks.withRoomLock(room.id, async () => {
          await this.rooms.deleteRoom(room.id);
          try {
            await this.stateStore.delete(room.id);
          } catch (error) {
            logger.warn({ error, roomId: room.id }, 'Room deleted from the database but Redis state cleanup failed');
          }
        });
        getBroadcaster().broadcastRoom(room.id, 'GAME_EVENT', {
          event: 'ROOM_CLOSED',
          roomId: room.roomCode
        });
        deleted += 1;
        logger.info({ roomId: room.id, roomCode: room.roomCode, status: room.status }, 'Expired room cleaned up');
      } catch (error) {
        logger.warn({ error, roomId: room.id }, 'Failed to clean up expired room');
      }
    }
    return deleted;
  }
}
