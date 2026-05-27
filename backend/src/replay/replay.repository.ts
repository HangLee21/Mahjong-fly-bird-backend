import { prisma } from '../storage/prisma.js';

export class ReplayRepository {
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
