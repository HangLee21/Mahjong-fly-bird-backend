import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GameService } from '../src/game/game.service.js';
import { QujingFeiXiaoJiRuleEngine } from '../src/rules/qujing-fei-xiaoji.js';
import type { GameState } from '../src/game/game.state.js';

vi.mock('../src/storage/room-state-store.js', () => ({
  roomStateStore: { get: vi.fn(), set: vi.fn(), delete: vi.fn() }
}));
vi.mock('../src/storage/prisma.js', () => ({
  prisma: {
    gameStep: { create: vi.fn(async () => ({})) },
    game: { count: vi.fn(async () => 0), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), findUnique: vi.fn() }
  }
}));
vi.mock('../src/storage/locks.js', () => ({
  lockManager: { withRoomLock: async (_roomId: string, fn: () => Promise<unknown>) => fn() }
}));
vi.mock('../src/websocket/ws-broadcast.js', () => ({
  getBroadcaster: () => ({ sendGameView: vi.fn(), broadcastRoom: vi.fn() })
}));
vi.mock('../src/ai/ai-gateway.js', () => ({
  aiGateway: {
    requestAction: vi.fn(async () => {
      throw new Error('AI service unreachable');
    })
  }
}));

import { roomStateStore } from '../src/storage/room-state-store.js';
import { prisma } from '../src/storage/prisma.js';
import { aiGateway } from '../src/ai/ai-gateway.js';

const mockedGet = vi.mocked(roomStateStore.get);
const mockedSet = vi.mocked(roomStateStore.set);
const mockedGameStep = vi.mocked(prisma.gameStep.create);

function freshState(): GameState {
  return new QujingFeiXiaoJiRuleEngine().createInitialState({
    roomId: 'room',
    gameId: 'game',
    ruleVersion: 'qujing-fei-xiaoji-v1.5',
    seed: 'robust-seed',
    players: [0, 1, 2, 3].map((seatIndex) => ({ seatIndex, isAI: false, userId: `u${seatIndex}` }))
  });
}

describe('game robustness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedSet.mockResolvedValue(undefined);
    mockedGet.mockResolvedValue(null);
  });

  it('rejects starting a game from a non-owner', async () => {
    const room = {
      id: 'internal-room',
      roomCode: '123456',
      ownerId: 'owner',
      status: 'WAITING',
      ruleVersion: 'qujing-fei-xiaoji-v1.5',
      configJson: {},
      seats: [{ seatIndex: 0, userId: 'member', isAI: false, status: 'READY' }]
    };
    const rooms = {
      findByIdOrCode: vi.fn(async () => room),
      findById: vi.fn(async () => room)
    };
    const service = new GameService(rooms as never);

    await expect(service.startGame('123456', 'member')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('auto-passes a disconnected player pending response and keeps the game moving', async () => {
    const state = freshState();
    state.status = 'WAITING_RESPONSE';
    state.lastDiscard = { tile: 5, fromPlayer: 0, stepIndex: 0 };
    state.pendingResponses = [
      { playerIndex: 1, availableActions: [{ type: 'PONG', tile: 5, actionId: 102 }], priority: 2, deadlineAt: Date.now() + 60000 },
      { playerIndex: 2, availableActions: [{ type: 'PONG', tile: 5, actionId: 102 }], priority: 2, deadlineAt: Date.now() + 60000 }
    ];
    state.players[1].hand = [5, 5, 0, 1, 2, 3, 4, 6, 7, 8, 9, 10, 11];
    state.players[2].hand = [5, 5, 12, 13, 14, 15, 16, 17, 19, 20, 22, 23, 24];
    mockedGet.mockResolvedValue(state);

    const service = new GameService({} as never);
    await service.resolveDisconnectedPlayer('room', 'u1');

    expect(mockedGameStep).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ actionSource: 'SYSTEM', playerIndex: 1 }) })
    );
    const saved = mockedSet.mock.calls.at(-1)?.[1] as GameState;
    expect((saved.pendingResponses ?? []).find((pending) => pending.playerIndex === 1)).toBeUndefined();
    expect((saved.pendingResponses ?? []).some((pending) => pending.playerIndex === 2)).toBe(true);
  });

  it('advanceAi falls back to a legal action when the AI service errors', async () => {
    const state = freshState();
    state.players[0].isAI = true;
    state.players[0].userId = undefined;
    mockedGet.mockResolvedValue(state);

    const service = new GameService({} as never);
    await service.advanceAi('room');

    expect(aiGateway.requestAction).toHaveBeenCalledTimes(1);
    expect(mockedGameStep).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ actionSource: 'FALLBACK' }) })
    );
    const saved = mockedSet.mock.calls.at(-1)?.[1] as GameState;
    expect(saved.stepIndex).toBeGreaterThan(state.stepIndex);
  });
});
