import { Prisma } from '@prisma/client';
import { createRoomCode } from '../common/ids.js';
import { env } from '../config/env.js';
import { prisma } from '../storage/prisma.js';

export class RoomRepository {
  async create(ownerId: string, configJson: Record<string, unknown>) {
    return prisma.room.create({
      data: {
        roomCode: createRoomCode(),
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
      include: { seats: { orderBy: { seatIndex: 'asc' } } }
    });
  }

  findById(roomId: string) {
    return prisma.room.findUnique({ where: { id: roomId }, include: { seats: { orderBy: { seatIndex: 'asc' } } } });
  }

  async join(roomId: string, userId: string) {
    const room = await this.findById(roomId);
    const seat = room?.seats.find((item) => item.status === 'EMPTY');
    if (!seat) return null;
    await prisma.roomSeat.update({
      where: { id: seat.id },
      data: { userId, isAI: false, status: 'READY' }
    });
    return this.findById(roomId);
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

  async addAi(roomId: string, aiLevel = 'normal', aiModel = 'heuristic_mock') {
    const room = await this.findById(roomId);
    const seat = room?.seats.find((item) => item.status === 'EMPTY');
    if (!seat) return null;
    await prisma.roomSeat.update({
      where: { id: seat.id },
      data: { isAI: true, aiLevel, aiModel, status: 'READY' }
    });
    return this.findById(roomId);
  }

  setStatus(roomId: string, status: string) {
    return prisma.room.update({ where: { id: roomId }, data: { status } });
  }
}
