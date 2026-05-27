import { AppError } from '../common/errors.js';
import { lockManager } from '../storage/locks.js';
import { RoomRepository } from './room.repository.js';

export class RoomService {
  constructor(private readonly rooms = new RoomRepository()) {}

  async createRoom(ownerId: string, config: Record<string, unknown> = { maxPlayers: 4, allowAi: true }) {
    return this.rooms.create(ownerId, config);
  }

  async getRoom(roomId: string) {
    const room = await this.rooms.findById(roomId);
    if (!room) throw new AppError('ROOM_NOT_FOUND', 'Room not found.', 404);
    return room;
  }

  async joinRoom(roomId: string, userId: string) {
    return lockManager.withRoomLock(roomId, async () => {
      const room = await this.getRoom(roomId);
      if (room.status !== 'WAITING') throw new AppError('GAME_ALREADY_STARTED', 'Game already started.');
      if (room.seats.some((seat) => seat.userId === userId)) return room;
      const updated = await this.rooms.join(roomId, userId);
      if (!updated) throw new AppError('ROOM_FULL', 'Room is full.');
      return updated;
    });
  }

  async leaveRoom(roomId: string, userId: string) {
    return lockManager.withRoomLock(roomId, async () => {
      const updated = await this.rooms.leave(roomId, userId);
      if (!updated) throw new AppError('ROOM_NOT_JOINED', 'User is not in room.');
      return updated;
    });
  }

  async addAi(roomId: string, userId: string, input: { aiLevel?: string; aiModel?: string }) {
    return lockManager.withRoomLock(roomId, async () => {
      const room = await this.getRoom(roomId);
      if (room.ownerId !== userId) throw new AppError('UNAUTHORIZED', 'Only owner can add AI.', 403);
      if (room.status !== 'WAITING') throw new AppError('GAME_ALREADY_STARTED', 'Game already started.');
      const updated = await this.rooms.addAi(roomId, input.aiLevel, input.aiModel);
      if (!updated) throw new AppError('ROOM_FULL', 'Room is full.');
      return updated;
    });
  }
}
