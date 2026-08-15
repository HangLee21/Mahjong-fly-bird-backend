import { env } from '../config/env.js';

type RoomSeatLike = {
  seatIndex: number;
  userId: string | null;
  isAI: boolean;
  status: string;
  user?: {
    id: string;
    nickname: string | null;
    avatarUrl: string | null;
  } | null;
};

export type RoomLike = {
  id: string;
  roomCode: string;
  ownerId: string;
  status: string;
  ruleVersion: string;
  configJson: unknown;
  seats: RoomSeatLike[];
};

export const defaultRoomRules = {
  preset: env.DEFAULT_RULE_VERSION,
  roundCount: 16,
  allowChow: true,
  allowPong: true,
  xiaoJiWildEnabled: true,
  fanCap: 3,
  publicKongTiles: 2,
  xiaoJiTile: '1-tiao',
  drawMode: 'fixed-wall-reserve',
  allowMultiWin: true
};

export function normalizeRoomRules(configJson: unknown, ruleVersion = env.DEFAULT_RULE_VERSION) {
  const config = typeof configJson === 'object' && configJson !== null ? configJson : {};
  return {
    ...defaultRoomRules,
    preset: ruleVersion,
    ...config
  };
}

export function presentRoom(room: RoomLike) {
  return {
    roomId: room.roomCode,
    internalRoomId: room.id,
    ownerId: room.ownerId,
    status: room.status,
    gameId: null,
    rules: normalizeRoomRules(room.configJson, room.ruleVersion),
    seats: room.seats.map((seat) => {
      const user = seat.user
        ? {
            id: seat.user.id,
            nickname: seat.user.nickname ?? '游客',
            avatarUrl: seat.user.avatarUrl ?? ''
          }
        : seat.isAI
          ? {
              id: `ai-${room.roomCode}-${seat.seatIndex}`,
              nickname: `AI ${seat.seatIndex}`,
              avatarUrl: ''
            }
          : undefined;
      return {
        seatIndex: seat.seatIndex,
        ...(user ? { user } : {}),
        isAI: seat.isAI,
        isReady: seat.status === 'READY',
        isOwner: seat.userId === room.ownerId,
        status: seat.status,
        occupied: seat.status !== 'EMPTY'
      };
    })
  };
}

export function presentRoomPreview(room: RoomLike | null, roomId: string) {
  if (!room) {
    return {
      exists: false,
      roomId,
      canJoin: false,
      message: 'Room not found.'
    };
  }

  const occupiedSeats = room.seats.filter((seat) => seat.status !== 'EMPTY');
  const ownerSeat = room.seats.find((seat) => seat.userId === room.ownerId);
  return {
    exists: true,
    roomId: room.roomCode,
    status: room.status,
    seatCount: occupiedSeats.length,
    maxSeats: room.seats.length,
    canJoin: room.status === 'WAITING' && occupiedSeats.length < room.seats.length,
    ownerNickname: ownerSeat?.user?.nickname ?? '游客',
    rules: normalizeRoomRules(room.configJson, room.ruleVersion)
  };
}
