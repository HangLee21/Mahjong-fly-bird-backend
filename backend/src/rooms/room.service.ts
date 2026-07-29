import { AppError } from '../common/errors.js';
import { logger } from '../common/logger.js';
import { lockManager, type LockManager } from '../storage/locks.js';
import { roomStateStore, type RoomStateStore } from '../storage/room-state-store.js';
import { getBroadcaster } from '../websocket/ws-broadcast.js';
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
      return result.room;
    });
  }

  async addAi(roomId: string, userId: string, input: { seatIndex?: number; aiLevel?: string; aiModel?: string }) {
    const target = await this.getRoom(roomId);
    return this.locks.withRoomLock(target.id, async () => {
      const room = await this.getRoom(target.id);
      void userId;
      if (room.status !== 'WAITING') throw new AppError('GAME_ALREADY_STARTED', 'Game already started.');
      if (!room.seats.some((seat) => seat.status === 'EMPTY')) return room;
      const updated = await this.rooms.addAi(room.id, input.aiLevel, input.aiModel, input.seatIndex);
      if (!updated) throw new AppError('ROOM_FULL', 'Room is full.');
      return updated;
    });
  }
}
