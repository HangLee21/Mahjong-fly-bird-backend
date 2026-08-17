import { describe, expect, it, vi } from 'vitest';
import type { RoomRepository } from '../src/rooms/room.repository.js';
import { RoomService } from '../src/rooms/room.service.js';
import type { LockManager } from '../src/storage/locks.js';
import type { RoomStateStore } from '../src/storage/room-state-store.js';

const targetRoom = {
  id: 'internal-room-id',
  roomCode: '123456',
  ownerId: 'user-1',
  status: 'WAITING',
  ruleVersion: 'rule-v1',
  configJson: {},
  createdAt: new Date(),
  updatedAt: new Date(),
  seats: []
};

function createLockManager(lockedIds: string[]): LockManager {
  return {
    async withRoomLock<T>(roomId: string, fn: () => Promise<T>) {
      lockedIds.push(roomId);
      return fn();
    }
  };
}

function createStateStore(deleteState: ReturnType<typeof vi.fn>): RoomStateStore {
  return {
    get: vi.fn(),
    set: vi.fn(),
    delete: deleteState
  } as unknown as RoomStateStore;
}

describe('room lifecycle', () => {
  it('atomically destroys the room and Redis state after the last real player leaves', async () => {
    const lockedIds: string[] = [];
    const deleteState = vi.fn(async () => undefined);
    const rooms = {
      findByIdOrCode: vi.fn(async () => targetRoom),
      leaveAndDestroyIfEmpty: vi.fn(async () => ({
        kind: 'deleted',
        roomId: targetRoom.roomCode,
        internalRoomId: targetRoom.id
      }))
    } as unknown as RoomRepository;
    const service = new RoomService(rooms, createStateStore(deleteState), createLockManager(lockedIds));

    await expect(service.leaveRoom('123456', 'user-1')).resolves.toEqual({
      deleted: true,
      roomId: '123456',
      internalRoomId: 'internal-room-id'
    });
    expect(lockedIds).toEqual(['internal-room-id']);
    expect(deleteState).toHaveBeenCalledWith('internal-room-id');
  });

  it('keeps the room and does not delete Redis state while a real player remains', async () => {
    const deleteState = vi.fn(async () => undefined);
    const updatedRoom = {
      ...targetRoom,
      ownerId: 'user-2',
      seats: [{ seatIndex: 1, userId: 'user-2', isAI: false, status: 'READY', user: null }]
    };
    const rooms = {
      findByIdOrCode: vi.fn(async () => targetRoom),
      leaveAndDestroyIfEmpty: vi.fn(async () => ({ kind: 'updated', room: updatedRoom }))
    } as unknown as RoomRepository;
    const service = new RoomService(rooms, createStateStore(deleteState), createLockManager([]));

    const result = await service.leaveRoom('123456', 'user-1');
    if ('deleted' in result) throw new Error('Room should not have been deleted.');
    expect(result.ownerId).toBe('user-2');
    expect(deleteState).not.toHaveBeenCalled();
  });

  it('lets the room owner update rules and persists the merged config', async () => {
    const updatedRoom = { ...targetRoom, configJson: { roundCount: 8 } };
    const rooms = {
      findByIdOrCode: vi.fn(async () => targetRoom),
      updateConfig: vi.fn(async () => updatedRoom)
    } as unknown as RoomRepository;
    const service = new RoomService(rooms, createStateStore(vi.fn()), createLockManager([]));

    const result = await service.updateRules('123456', 'user-1', { roundCount: 8 });
    expect(rooms.updateConfig).toHaveBeenCalledWith('internal-room-id', { roundCount: 8 });
    expect(result.configJson).toEqual({ roundCount: 8 });
  });

  it('rejects rule changes from a non-owner', async () => {
    const rooms = {
      findByIdOrCode: vi.fn(async () => targetRoom)
    } as unknown as RoomRepository;
    const service = new RoomService(rooms, createStateStore(vi.fn()), createLockManager([]));

    await expect(service.updateRules('123456', 'user-2', { roundCount: 8 })).rejects.toThrow(/owner/);
  });

  it('rejects adding AI from a non-owner', async () => {
    const addAi = vi.fn();
    const rooms = {
      findByIdOrCode: vi.fn(async () => targetRoom),
      addAi
    } as unknown as RoomRepository;
    const service = new RoomService(rooms, createStateStore(vi.fn()), createLockManager([]));

    await expect(service.addAi('123456', 'user-2', {})).rejects.toThrow(/owner/);
    expect(addAi).not.toHaveBeenCalled();
  });
});
