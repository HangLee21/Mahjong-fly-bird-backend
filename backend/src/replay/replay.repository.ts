import { prisma } from '../storage/prisma.js';

export class ReplayRepository {
  listGames(userId: string) {
    return prisma.game.findMany({
      where: { players: { some: { userId } } },
      orderBy: { startedAt: 'desc' },
      include: { room: true }
    });
  }

  findGame(gameId: string) {
    return prisma.game.findUnique({ where: { id: gameId }, include: { room: true } });
  }

  listGameSteps(gameId: string) {
    return prisma.gameStep.findMany({ where: { gameId }, orderBy: { stepIndex: 'asc' } });
  }

  exportSteps(from: Date, to: Date) {
    return prisma.gameStep.findMany({
      where: { createdAt: { gte: from, lte: to } },
      orderBy: [{ gameId: 'asc' }, { stepIndex: 'asc' }]
    });
  }
}
