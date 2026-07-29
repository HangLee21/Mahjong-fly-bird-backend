import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth/auth.routes.js';
import { prisma } from '../storage/prisma.js';

function presentUser(user: { id: string; nickname: string | null; avatarUrl: string | null }) {
  return {
    id: user.id,
    nickname: user.nickname ?? '游客',
    avatarUrl: user.avatarUrl ?? ''
  };
}

export async function registerLobbyRoutes(app: FastifyInstance) {
  app.get('/api/lobby/summary', async (request) => {
    const auth = await requireAuth(request);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: auth.userId } });
    const activeSeat = await prisma.roomSeat.findFirst({
      where: {
        userId: auth.userId,
        room: { status: { in: ['WAITING', 'PLAYING'] } }
      },
      orderBy: { room: { updatedAt: 'desc' } },
      include: {
        room: {
          include: {
            games: {
              orderBy: { startedAt: 'desc' },
              take: 1
            }
          }
        }
      }
    });
    const recentGames = await prisma.game.findMany({
      where: { players: { some: { userId: auth.userId } } },
      orderBy: { startedAt: 'desc' },
      take: 10,
      include: { room: true }
    });

    const activeRoom = activeSeat
      ? {
          roomId: activeSeat.room.roomCode,
          status: activeSeat.room.status,
          gameId: activeSeat.room.games[0]?.id ?? null
        }
      : null;

    return {
      user: presentUser(user),
      notice: '欢迎体验曲靖飞小鸡',
      activeRoom,
      recentRooms: recentGames.map((game) => ({
        roomId: game.room.roomCode,
        gameId: game.id,
        finishedAt: game.finishedAt?.getTime() ?? null,
        title: `曲靖飞小鸡 ${game.room.roomCode}`
      }))
    };
  });
}
