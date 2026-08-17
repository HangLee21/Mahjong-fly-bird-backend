import { Prisma } from '@prisma/client';
import { createRoomCode } from '../common/ids.js';
import { env } from '../config/env.js';
import { prisma } from '../storage/prisma.js';

export class RoomRepository {
  async create(ownerId: string, configJson: Record<string, unknown>, roomCode = createRoomCode()) {
    return prisma.room.create({
      data: {
        roomCode,
        status: 'WAITING',
        ownerId,
        ruleVersion: env.DEFAULT_RULE_VERSION,
        configJson: configJson as Prisma.InputJsonObject,
        seats: {
          create: [
            { seatIndex: 0, userId: ownerId, isAI: false, status: 'READY' },
            { seatIndex: 1, isAI: false, status: 'EMPTY' },
            { seatIndex: 2, isAI: false, status: 'EMPTY' },
            { seatIndex: 3, isAI: false, status: 'EMPTY' }
          ]
        }
      },
      include: { seats: { orderBy: { seatIndex: 'asc' }, include: { user: true } } }
    });
  }

  findById(roomId: string) {
    return prisma.room.findUnique({
      where: { id: roomId },
      include: { seats: { orderBy: { seatIndex: 'asc' }, include: { user: true } } }
    });
  }

  findByIdOrCode(roomId: string) {
    return prisma.room.findFirst({
      where: { OR: [{ id: roomId }, { roomCode: roomId }] },
      include: { seats: { orderBy: { seatIndex: 'asc' }, include: { user: true } } }
    });
  }

  findMany(input: { status?: string; updatedBefore?: Date }) {
    return prisma.room.findMany({
      where: {
        ...(input.status ? { status: input.status } : {}),
        ...(input.updatedBefore ? { updatedAt: { lte: input.updatedBefore } } : {})
      },
      orderBy: { updatedAt: 'asc' },
      include: { seats: { orderBy: { seatIndex: 'asc' }, include: { user: true } } }
    });
  }

  async join(roomId: string, userId: string, seatIndex?: number) {
    const room = await this.findById(roomId);
    const seat = room?.seats.find((item) => item.status === 'EMPTY' && (seatIndex === undefined || item.seatIndex === seatIndex));
    if (!seat) return null;
    await prisma.roomSeat.update({
      where: { id: seat.id },
      data: { userId, isAI: false, status: 'READY' }
    });
    return this.findById(roomId);
  }

  async setReady(roomId: string, userId: string, ready: boolean) {
    const room = await this.findById(roomId);
    const seat = room?.seats.find((item) => item.userId === userId && !item.isAI);
    if (!seat) return null;
    await prisma.roomSeat.update({
      where: { id: seat.id },
      data: { status: ready ? 'READY' : 'OCCUPIED' }
    });
    return this.findById(roomId);
  }

  async updateConfig(roomId: string, configJson: Record<string, unknown>) {
    return prisma.room.update({
      where: { id: roomId },
      data: { configJson: configJson as Prisma.InputJsonObject },
      include: { seats: { orderBy: { seatIndex: 'asc' }, include: { user: true } } }
    });
  }

  async leave(roomId: string, userId: string) {
    const room = await this.findById(roomId);
    const seat = room?.seats.find((item) => item.userId === userId);
    if (!seat) return null;
    await prisma.roomSeat.update({
      where: { id: seat.id },
      data: { userId: null, isAI: false, aiLevel: null, aiModel: null, status: 'EMPTY' }
    });
    return this.findById(roomId);
  }

  async leaveAndDestroyIfEmpty(roomId: string, userId: string) {
    return prisma.$transaction(async (tx) => {
      const room = await tx.room.findUnique({
        where: { id: roomId },
        include: { seats: { orderBy: { seatIndex: 'asc' }, include: { user: true } } }
      });
      if (!room) return { kind: 'not_found' } as const;

      const seat = room.seats.find((item) => item.userId === userId && !item.isAI);
      if (!seat) return { kind: 'not_joined' } as const;

      await tx.roomSeat.update({
        where: { id: seat.id },
        data: { userId: null, isAI: false, aiLevel: null, aiModel: null, status: 'EMPTY' }
      });

      const remainingPlayers = await tx.roomSeat.findMany({
        where: { roomId, isAI: false, userId: { not: null } },
        orderBy: { seatIndex: 'asc' },
        select: { userId: true }
      });

      if (remainingPlayers.length === 0) {
        const games = await tx.game.findMany({ where: { roomId }, select: { id: true } });
        const gameIds = games.map((game) => game.id);
        await tx.gameStep.deleteMany({ where: { gameId: { in: gameIds } } });
        await tx.gamePlayer.deleteMany({ where: { gameId: { in: gameIds } } });
        await tx.game.deleteMany({ where: { roomId } });
        await tx.roomSeat.deleteMany({ where: { roomId } });
        await tx.room.delete({ where: { id: roomId } });
        return {
          kind: 'deleted',
          roomId: room.roomCode,
          internalRoomId: room.id
        } as const;
      }

      await tx.room.update({
        where: { id: roomId },
        data: {
          status: room.status,
          ...(room.ownerId === userId && remainingPlayers[0]?.userId ? { ownerId: remainingPlayers[0].userId } : {})
        }
      });

      const updated = await tx.room.findUniqueOrThrow({
        where: { id: roomId },
        include: { seats: { orderBy: { seatIndex: 'asc' }, include: { user: true } } }
      });
      return { kind: 'updated', room: updated } as const;
    });
  }

  async deleteRoom(roomId: string) {
    const games = await prisma.game.findMany({ where: { roomId }, select: { id: true } });
    const gameIds = games.map((game) => game.id);
    await prisma.$transaction([
      prisma.gameStep.deleteMany({ where: { gameId: { in: gameIds } } }),
      prisma.gamePlayer.deleteMany({ where: { gameId: { in: gameIds } } }),
      prisma.game.deleteMany({ where: { roomId } }),
      prisma.roomSeat.deleteMany({ where: { roomId } }),
      prisma.room.delete({ where: { id: roomId } })
    ]);
  }

  async addAi(roomId: string, aiLevel = 'normal', aiModel = 'v3-lite', seatIndex?: number) {
    const room = await this.findById(roomId);
    const seat =
      room?.seats.find((item) => item.status === 'EMPTY' && item.seatIndex === seatIndex) ??
      room?.seats.find((item) => item.status === 'EMPTY');
    if (!seat) return null;
    await prisma.roomSeat.update({
      where: { id: seat.id },
      data: { isAI: true, aiLevel, aiModel, status: 'READY' }
    });
    return this.findById(roomId);
  }

  async removeAi(roomId: string, seatIndex?: number) {
    const room = await this.findById(roomId);
    const seat =
      room?.seats.find((item) => item.isAI && item.seatIndex === seatIndex) ??
      room?.seats.find((item) => item.isAI);
    if (!seat) return null;
    await prisma.roomSeat.update({
      where: { id: seat.id },
      data: { userId: null, isAI: false, aiLevel: null, aiModel: null, status: 'EMPTY' }
    });
    return this.findById(roomId);
  }

  async kickPlayer(roomId: string, seatIndex: number) {
    const room = await this.findById(roomId);
    const seat = room?.seats.find((item) => item.seatIndex === seatIndex && item.userId && !item.isAI);
    if (!seat) return null;
    await prisma.roomSeat.update({
      where: { id: seat.id },
      data: { userId: null, isAI: false, aiLevel: null, aiModel: null, status: 'EMPTY' }
    });
    return this.findById(roomId);
  }

  async transferOwner(roomId: string, newOwnerId: string) {
    const room = await this.findById(roomId);
    const seat = room?.seats.find((item) => item.userId === newOwnerId && !item.isAI);
    if (!seat) return null;
    await prisma.room.update({ where: { id: roomId }, data: { ownerId: newOwnerId } });
    return this.findById(roomId);
  }

  setStatus(roomId: string, status: string) {
    return prisma.room.update({ where: { id: roomId }, data: { status } });
  }
}
