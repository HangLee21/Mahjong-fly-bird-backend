import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { AppError } from '../common/errors.js';
import { env } from '../config/env.js';
import { aiGateway } from '../ai/ai-gateway.js';
import { buildObservation } from '../ai/observation.builder.js';
import { fallbackAction } from '../ai/fallback-policy.js';
import { decodeAction, encodeAction, normalizeClientAction, sameAction, type ClientAction, type GameAction } from '../rules/actions.js';
import { ruleEngine } from '../rules/rule-engine.js';
import { prisma } from '../storage/prisma.js';
import { lockManager } from '../storage/locks.js';
import { roomStateStore } from '../storage/room-state-store.js';
import { RoomRepository } from '../rooms/room.repository.js';
import { getBroadcaster } from '../websocket/ws-broadcast.js';
import type { GameState } from './game.state.js';
import type { PlayerGameView } from './game.types.js';

export type ActionSource = 'HUMAN' | 'AI' | 'FALLBACK' | 'SYSTEM';

export class GameService {
  constructor(private readonly rooms = new RoomRepository()) {}

  async startGame(roomId: string, userId: string) {
    return lockManager.withRoomLock(roomId, async () => {
      const room = await this.rooms.findById(roomId);
      if (!room) throw new AppError('ROOM_NOT_FOUND', 'Room not found.', 404);
      if (room.ownerId !== userId) throw new AppError('UNAUTHORIZED', 'Only owner can start game.', 403);
      if (room.status !== 'WAITING') throw new AppError('GAME_ALREADY_STARTED', 'Game already started.');
      if (room.seats.length !== 4 || room.seats.some((seat) => seat.status === 'EMPTY')) {
        throw new AppError('ROOM_FULL', 'Room needs 4 occupied seats before starting.');
      }

      const game = await prisma.game.create({
        data: {
          roomId,
          status: 'PLAYING',
          ruleVersion: room.ruleVersion,
          observationVer: env.DEFAULT_OBSERVATION_VERSION,
          actionVersion: env.DEFAULT_ACTION_VERSION,
          seed: randomUUID(),
          players: {
            create: room.seats.map((seat) => ({
              seatIndex: seat.seatIndex,
              userId: seat.userId,
              isAI: seat.isAI,
              aiModel: seat.aiModel
            }))
          }
        }
      });

      const state = ruleEngine.createInitialState({
        roomId,
        gameId: game.id,
        ruleVersion: room.ruleVersion,
        seed: game.seed,
        players: room.seats.map((seat) => ({
          seatIndex: seat.seatIndex,
          userId: seat.userId ?? undefined,
          isAI: seat.isAI,
          aiModel: seat.aiModel ?? undefined
        }))
      });

      await this.rooms.setStatus(roomId, 'PLAYING');
      await roomStateStore.set(roomId, state);
      await this.broadcastViews(state);
      setTimeout(() => void this.advanceAi(roomId), 0);
      const ownerIndex = state.players.findIndex((player) => player.userId === userId);
      if (ownerIndex < 0) throw new AppError('ROOM_NOT_JOINED', 'Owner is not seated in room.');
      return ruleEngine.buildPlayerView(state, ownerIndex);
    });
  }

  async submitAction(roomId: string, userId: string, input: ClientAction): Promise<PlayerGameView> {
    const action = normalizeClientAction(input);
    const view = await lockManager.withRoomLock(roomId, async () => {
      const state = await this.getState(roomId);
      const playerIndex = state.players.findIndex((player) => player.userId === userId);
      if (playerIndex < 0) throw new AppError('ROOM_NOT_JOINED', 'User is not in room.');
      if (state.currentPlayer !== playerIndex) throw new AppError('NOT_YOUR_TURN', 'It is not your turn.');
      const nextState = await this.applyValidatedAction(state, playerIndex, action, 'HUMAN');
      await this.broadcastViews(nextState);
      return ruleEngine.buildPlayerView(nextState, playerIndex);
    });
    setTimeout(() => void this.advanceAi(roomId), 0);
    return view;
  }

  async getGameView(roomId: string, userId: string): Promise<PlayerGameView> {
    const state = await this.getState(roomId);
    const playerIndex = state.players.findIndex((player) => player.userId === userId);
    if (playerIndex < 0) throw new AppError('ROOM_NOT_JOINED', 'User is not in room.');
    return ruleEngine.buildPlayerView(state, playerIndex);
  }

  async resumeGame(roomId: string, userId: string) {
    return this.getGameView(roomId, userId);
  }

  private async getState(roomId: string): Promise<GameState> {
    const state = await roomStateStore.get(roomId);
    if (!state) throw new AppError('GAME_NOT_STARTED', 'Game has not started.', 404);
    if (state.status === 'FINISHED') throw new AppError('GAME_NOT_STARTED', 'Game is finished.');
    return state;
  }

  private async applyValidatedAction(
    state: GameState,
    playerIndex: number,
    action: GameAction,
    source: ActionSource,
    aiModel?: string
  ): Promise<GameState> {
    const legalActions = ruleEngine.getLegalActions(state, playerIndex);
    if (!legalActions.some((legal) => sameAction(legal, action))) {
      throw new AppError('ILLEGAL_ACTION', 'Action is not legal in current state.');
    }

    const stateHashBefore = ruleEngine.hashState(state);
    const result = ruleEngine.applyAction(state, playerIndex, action);
    const stateHashAfter = ruleEngine.hashState(result.nextState);
    await roomStateStore.set(state.roomId, result.nextState);

    await prisma.gameStep.create({
      data: {
        gameId: state.gameId,
        stepIndex: state.stepIndex,
        playerIndex,
        actionJson: action as object,
        legalActionsJson: legalActions.map(encodeAction),
        publicViewJson: ruleEngine.buildPlayerView(result.nextState, playerIndex) as object,
        privateViewJson: { observation: buildObservation(state, playerIndex) },
        stateHashBefore,
        stateHashAfter,
        rewardJson: result.scoreResult ? { scores: result.scoreResult.scores } : undefined,
        aiModel,
        actionSource: source
      }
    });

    if (result.nextState.status === 'FINISHED') {
      await prisma.game.update({
        where: { id: state.gameId },
        data: {
          status: 'FINISHED',
          finishedAt: new Date(),
          finalScoreJson: { scores: result.nextState.scores },
          resultJson: (result.scoreResult ?? {}) as Prisma.InputJsonObject
        }
      });
      await this.rooms.setStatus(state.roomId, 'FINISHED');
    }

    return result.nextState;
  }

  async advanceAi(roomId: string) {
    for (let count = 0; count < env.MAX_AI_ACTIONS_PER_TICK; count += 1) {
      const moved = await lockManager.withRoomLock(roomId, async () => {
        const state = await roomStateStore.get(roomId);
        if (!state || state.status !== 'PLAYING') return false;
        const player = state.players[state.currentPlayer];
        if (!player?.isAI) return false;

        const legal = ruleEngine.getLegalActions(state, player.seatIndex);
        if (legal.length === 0) return false;

        const legalActionIds = legal.map(encodeAction);
        let source: ActionSource = 'AI';
        let action: GameAction;
        let aiModel = player.aiModel ?? 'heuristic_mock';

        try {
          const ai = await aiGateway.requestAction({
            roomId,
            gameId: state.gameId,
            playerIndex: player.seatIndex,
            modelVersion: aiModel,
            observation: buildObservation(state, player.seatIndex),
            legalActions: legalActionIds
          });
          const decoded = decodeAction(ai.actionId);
          action = legal.some((item) => sameAction(item, decoded)) ? decoded : fallbackAction(legal);
          if (!sameAction(action, decoded)) source = 'FALLBACK';
          aiModel = ai.modelVersion;
        } catch {
          action = fallbackAction(legal);
          source = 'FALLBACK';
        }

        const nextState = await this.applyValidatedAction(state, player.seatIndex, action, source, aiModel);
        await this.broadcastViews(nextState);
        return nextState.status === 'PLAYING' && nextState.players[nextState.currentPlayer]?.isAI;
      });
      if (!moved) break;
    }
  }

  private async broadcastViews(state: GameState) {
    const broadcaster = getBroadcaster();
    for (const player of state.players) {
      broadcaster.sendGameView(state.roomId, player.userId, ruleEngine.buildPlayerView(state, player.seatIndex));
    }
    broadcaster.broadcastRoom(state.roomId, 'GAME_EVENT', { gameId: state.gameId, stepIndex: state.stepIndex, status: state.status });
  }
}

export const gameService = new GameService();
