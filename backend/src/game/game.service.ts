import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { AppError } from '../common/errors.js';
import { env } from '../config/env.js';
import { aiGateway } from '../ai/ai-gateway.js';
import type { AiActionResult } from '../ai/ai.types.js';
import { buildObservation } from '../ai/observation.builder.js';
import { fallbackAction } from '../ai/fallback-policy.js';
import { decodeAction, encodeAction, normalizeClientAction, sameAction, type ClientAction, type GameAction } from '../rules/actions.js';
import { ruleEngine } from '../rules/rule-engine.js';
import { prisma } from '../storage/prisma.js';
import { lockManager } from '../storage/locks.js';
import { roomStateStore } from '../storage/room-state-store.js';
import { logger } from '../common/logger.js';
import { RoomRepository } from '../rooms/room.repository.js';
import { normalizeRoomRules, presentRoom } from '../rooms/room.presenter.js';
import { getBroadcaster } from '../websocket/ws-broadcast.js';
import { nextOverdueAction, earliestDeadline, autoResolveAction } from './game-deadline.js';
import type { GameState } from './game.state.js';
import type { PlayerGameView } from './game.types.js';

export type ActionSource = 'HUMAN' | 'AI' | 'FALLBACK' | 'SYSTEM';

export class GameService {
  private readonly roomDeadlineTimers = new Map<string, NodeJS.Timeout>();
  private readonly roomAiTimers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly rooms = new RoomRepository()) {}

  async startGame(roomId: string, userId: string) {
    const target = await this.rooms.findByIdOrCode(roomId);
    if (!target) throw new AppError('ROOM_NOT_FOUND', 'Room not found.', 404);
    return lockManager.withRoomLock(target.id, async () => {
      const room = await this.rooms.findById(target.id);
      if (!room) throw new AppError('ROOM_NOT_FOUND', 'Room not found.', 404);
      if (!room.seats.some((seat) => seat.userId === userId)) throw new AppError('ROOM_NOT_JOINED', 'User is not in room.', 403);
      if (room.status === 'PLAYING') return this.getGameView(room.id, userId);
      if (room.status !== 'WAITING' && room.status !== 'FINISHED') throw new AppError('GAME_ALREADY_STARTED', 'Game already started.');
      if (room.seats.length !== 4 || room.seats.some((seat) => seat.status === 'EMPTY')) {
        throw new AppError('ROOM_FULL', 'Room needs 4 occupied seats before starting.');
      }
      const rules = normalizeRoomRules(room.configJson, room.ruleVersion);
      const maxRounds = Number(rules.roundCount) || 1;
      const completedRounds = await prisma.game.count({ where: { roomId: room.id, status: 'FINISHED' } });
      if (room.status === 'FINISHED' && completedRounds >= maxRounds) {
        throw new AppError('GAME_ALREADY_STARTED', 'All rounds have finished.');
      }
      const currentRound = completedRounds + 1;
      const previousGame = await prisma.game.findFirst({
        where: { roomId: room.id, status: 'FINISHED' },
        orderBy: { finishedAt: 'desc' }
      });
      const totalScores = this.extractScores(previousGame?.finalScoreJson);
      const gameSeed = randomUUID();
      const dealer = previousGame ? this.nextDealer(previousGame.resultJson, gameSeed) : this.dealerFromSeed(gameSeed);

      const game = await prisma.game.create({
        data: {
          roomId: room.id,
          status: 'PLAYING',
          ruleVersion: room.ruleVersion,
          observationVer: env.DEFAULT_OBSERVATION_VERSION,
          actionVersion: env.DEFAULT_ACTION_VERSION,
          seed: gameSeed,
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
        roomId: room.id,
        gameId: game.id,
        ruleVersion: room.ruleVersion,
        seed: game.seed,
        currentRound,
        maxRounds,
        totalScores,
        dealer,
        players: room.seats.map((seat) => ({
          seatIndex: seat.seatIndex,
          userId: seat.userId ?? undefined,
          nickname: seat.user?.nickname ?? undefined,
          avatarUrl: seat.user?.avatarUrl ?? undefined,
          isAI: seat.isAI,
          aiModel: seat.aiModel ?? undefined
        }))
      });

      await this.rooms.setStatus(room.id, 'PLAYING');
      await roomStateStore.set(room.id, state);
      getBroadcaster().broadcastRoom(room.id, 'ROOM_VIEW', {
        ...presentRoom({ ...room, status: 'PLAYING' }),
        gameId: game.id
      });
      await this.broadcastViews(state);
      this.scheduleAdvanceAi(room.id);
      const playerIndex = state.players.findIndex((player) => player.userId === userId);
      if (playerIndex < 0) throw new AppError('ROOM_NOT_JOINED', 'User is not seated in room.');
      return ruleEngine.buildPlayerView(state, playerIndex);
    });
  }

  async submitAction(roomId: string, userId: string, input: ClientAction): Promise<PlayerGameView> {
    const action = normalizeClientAction(input);
    const room = await this.rooms.findByIdOrCode(roomId);
    const lockRoomId = room?.id ?? roomId;
    let internalRoomId = lockRoomId;
    const view = await lockManager.withRoomLock(lockRoomId, async () => {
      const state = await this.getState(lockRoomId);
      internalRoomId = state.roomId;
      const expired = await this.expireOverdue(state);
      if (expired !== state) await this.broadcastViews(expired);
      const playerIndex = expired.players.findIndex((player) => player.userId === userId);
      if (playerIndex < 0) throw new AppError('ROOM_NOT_JOINED', 'User is not in room.');
      const nextState = await this.applyValidatedAction(expired, playerIndex, action, 'HUMAN');
      await this.broadcastViews(nextState);
      return ruleEngine.buildPlayerView(nextState, playerIndex);
    });
    this.scheduleAdvanceAi(internalRoomId);
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
    const room = await this.rooms.findByIdOrCode(roomId);
    const state = await roomStateStore.get(room?.id ?? roomId);
    if (!state) throw new AppError('GAME_NOT_STARTED', 'Game has not started.', 404);
    return state;
  }

  async getGameViewByGameId(gameId: string, userId: string) {
    const game = await prisma.game.findUnique({ where: { id: gameId } });
    if (!game) throw new AppError('GAME_NOT_FOUND', 'Game not found.', 404);
    return this.getGameView(game.roomId, userId);
  }

  async submitActionByGameId(gameId: string, userId: string, input: ClientAction) {
    const game = await prisma.game.findUnique({ where: { id: gameId } });
    if (!game) throw new AppError('GAME_NOT_FOUND', 'Game not found.', 404);
    return this.submitAction(game.roomId, userId, input);
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
      // totalScores 已是跨局累计值（上一局结转 + 本局得失），直接持久化。
      const finalScores = result.nextState.totalScores ?? result.nextState.scores;
      const finishedState = { ...result.nextState, totalScores: finalScores };
      const isFinalRound = (finishedState.currentRound ?? 1) >= (finishedState.maxRounds ?? 1);
      await roomStateStore.set(state.roomId, finishedState);
      await prisma.game.update({
        where: { id: state.gameId },
        data: {
          status: 'FINISHED',
          finishedAt: new Date(),
          finalScoreJson: { scores: finalScores },
          resultJson: (result.scoreResult ?? {}) as Prisma.InputJsonObject
        }
      });
      await this.rooms.setStatus(state.roomId, isFinalRound ? 'FINISHED' : 'WAITING');
      return finishedState;
    }

    return result.nextState;
  }

  private extractScores(value: Prisma.JsonValue | null | undefined): number[] {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [0, 0, 0, 0];
    const scores = (value as { scores?: unknown }).scores;
    if (!Array.isArray(scores)) return [0, 0, 0, 0];
    return [0, 1, 2, 3].map((index) => (typeof scores[index] === 'number' ? scores[index] : 0));
  }

  private addScores(totalScores: number[] | undefined, roundScores: number[] | undefined): number[] {
    const totals = totalScores ?? [0, 0, 0, 0];
    const round = roundScores ?? [0, 0, 0, 0];
    return [0, 1, 2, 3].map((index) => (totals[index] ?? 0) + (round[index] ?? 0));
  }

  private nextDealer(previousResult: Prisma.JsonValue | null | undefined, fallbackSeed: string) {
    return resolveNextDealer(previousResult, this.dealerFromSeed(fallbackSeed));
  }

  private dealerFromSeed(seed: string) {
    let hash = 0;
    for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    return hash % 4;
  }

  private asJsonObject(value: Prisma.JsonValue | null | undefined) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    return value as Record<string, unknown>;
  }

  async advanceAi(roomId: string) {
    let moved = false;
    try {
      moved = await lockManager.withRoomLock(roomId, async () => {
          const state = await roomStateStore.get(roomId);
          if (!state || !['PLAYING', 'WAITING_RESPONSE'].includes(state.status)) return false;
          const current = await this.expireOverdue(state);
          const aiPlayer = this.nextAiPlayerWithActions(current);
          if (!aiPlayer) {
            if (current !== state) await this.broadcastViews(current);
            return false;
          }

          const legal = ruleEngine.getLegalActions(current, aiPlayer.seatIndex);
          if (legal.length === 0) return false;

          const legalActionIds = legal.map(encodeAction);
          let source: ActionSource = 'AI';
          let action: GameAction;
          let aiModel = aiPlayer.aiModel ?? 'v3-lite';

          try {
            const ai = await aiGateway.requestAction({
              roomId,
              gameId: current.gameId,
              playerIndex: aiPlayer.seatIndex,
              modelVersion: aiModel,
              observation: buildObservation(current, aiPlayer.seatIndex),
              legalActions: legalActionIds,
              state: current
            });
            const decoded = decodeAiAction(ai, legal);
            action = legal.some((item) => sameAction(item, decoded)) ? decoded : fallbackAction(legal);
            if (ai.fallbackUsed || !sameAction(action, decoded)) source = 'FALLBACK';
            aiModel = ai.modelVersion;
          } catch (error) {
            logger.warn({ error, roomId, gameId: current.gameId, playerIndex: aiPlayer.seatIndex, aiModel }, 'AI action request failed; using fallback action');
            action = fallbackAction(legal);
            source = 'FALLBACK';
          }

          const nextState = await this.applyValidatedAction(current, aiPlayer.seatIndex, action, source, aiModel);
          await this.broadcastViews(nextState);
          return Boolean(this.nextAiPlayerWithActions(nextState));
      });
    } catch (error) {
      // Transient lock/Redis/AI infrastructure failures must not crash the
      // process or strand the room; retry shortly and stop this cycle.
      logger.warn({ error, roomId }, 'AI advance step failed; scheduling retry');
      this.scheduleAdvanceAi(roomId, env.AI_ADVANCE_RETRY_DELAY_MS);
      return;
    }
    if (moved) this.scheduleAdvanceAi(roomId);
  }

  /**
   * Auto-applies any overdue pending responses / kong selections (SYSTEM pass).
   * Returns the (possibly unchanged) final state.
   */
  private async expireOverdue(state: GameState): Promise<GameState> {
    let current = state;
    for (let guard = 0; guard < 8; guard += 1) {
      const overdue = nextOverdueAction(current);
      if (!overdue) break;
      const legal = ruleEngine.getLegalActions(current, overdue.playerIndex);
      if (!legal.some((item) => sameAction(item, overdue.action))) break;
      current = await this.applyValidatedAction(current, overdue.playerIndex, overdue.action, 'SYSTEM');
    }
    return current;
  }

  /**
   * Immediately auto-passes a disconnected player's pending response so the
   * rest of the table is never blocked by an offline seat.
   */
  async resolveDisconnectedPlayer(roomId: string, userId: string) {
    let advanced = false;
    await lockManager.withRoomLock(roomId, async () => {
      const state = await roomStateStore.get(roomId);
      if (!state) return;
      const playerIndex = state.players.findIndex((player) => player.userId === userId);
      if (playerIndex < 0) return;
      const forced = autoResolveAction(state, playerIndex);
      if (!forced) return;
      const legal = ruleEngine.getLegalActions(state, playerIndex);
      if (!legal.some((item) => sameAction(item, forced.action))) return;
      const next = await this.applyValidatedAction(state, playerIndex, forced.action, 'SYSTEM');
      await this.broadcastViews(next);
      advanced = true;
    });
    if (advanced) this.scheduleAdvanceAi(roomId);
  }

  private scheduleAdvanceAi(roomId: string, delayMs = env.AI_ACTION_DELAY_MS) {
    if (this.roomAiTimers.has(roomId)) return;
    const timer = setTimeout(() => {
      this.roomAiTimers.delete(roomId);
      void this.advanceAi(roomId).catch((error) => {
        logger.error({ error, roomId }, 'AI advance failed unexpectedly');
      });
    }, delayMs);
    this.roomAiTimers.set(roomId, timer);
    timer.unref?.();
  }

  /**
   * Schedules a timer at the earliest pending response/kong deadline so idle
   * players are auto-passed even when nobody submits an action.
   */
  private scheduleRoomDeadline(roomId: string) {
    const existing = this.roomDeadlineTimers.get(roomId);
    if (existing) clearTimeout(existing);
    void roomStateStore
      .get(roomId)
      .then((state) => {
        if (!state) return;
        const deadline = earliestDeadline(state);
        if (deadline === undefined) return;
        const delay = Math.max(0, deadline - Date.now());
        const timer = setTimeout(() => {
          this.roomDeadlineTimers.delete(roomId);
          void this.expireRoomAndAdvance(roomId);
        }, delay);
        timer.unref?.();
        this.roomDeadlineTimers.set(roomId, timer);
      })
      .catch((error) => logger.warn({ error, roomId }, 'Failed to schedule room response deadline'));
  }

  private async expireRoomAndAdvance(roomId: string) {
    try {
      await lockManager.withRoomLock(roomId, async () => {
        const state = await roomStateStore.get(roomId);
        if (!state) return;
        const next = await this.expireOverdue(state);
        if (next !== state) await this.broadcastViews(next);
      });
    } catch (error) {
      logger.warn({ error, roomId }, 'Failed to expire overdue room state');
      return;
    }
    this.scheduleAdvanceAi(roomId);
  }

  private nextAiPlayerWithActions(state: GameState) {
    if (state.status === 'WAITING_RESPONSE') {
      return (state.pendingResponses ?? [])
        .sort((a, b) => b.priority - a.priority)
        .map((pending) => state.players[pending.playerIndex])
        .find((player) => player?.isAI && ruleEngine.getLegalActions(state, player.seatIndex).length > 0);
    }
    const player = state.players[state.currentPlayer];
    if (state.status === 'PLAYING' && player?.isAI && ruleEngine.getLegalActions(state, player.seatIndex).length > 0) return player;
    return undefined;
  }

  private async broadcastViews(state: GameState) {
    const broadcaster = getBroadcaster();
    for (const player of state.players) {
      broadcaster.sendGameView(state.roomId, player.userId, ruleEngine.buildPlayerView(state, player.seatIndex));
    }
    broadcaster.broadcastRoom(state.roomId, 'GAME_EVENT', { gameId: state.gameId, stepIndex: state.stepIndex, status: state.status });
    this.scheduleRoomDeadline(state.roomId);
  }
}

export function resolveNextDealer(previousResult: unknown, fallbackDealer: number) {
  const result = asJsonObject(previousResult);
  const winners = Array.isArray(result?.winnerIndexes) ? result.winnerIndexes.filter(isSeatIndex) : [];
  const losers = Array.isArray(result?.loserIndexes) ? result.loserIndexes.filter(isSeatIndex) : [];

  if (winners.length > 1 && losers.length > 0) return losers[0];
  if (winners.length === 1) return winners[0];

  const previousDealer = isSeatIndex(result?.dealer) ? result.dealer : undefined;
  return previousDealer ?? (isSeatIndex(fallbackDealer) ? fallbackDealer : 0);
}

function isSeatIndex(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === 'number' && value >= 0 && value < 4;
}

function asJsonObject(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function decodeAiAction(ai: AiActionResult, legal: GameAction[]): GameAction {
  const bySemantic = decodeAiActionBySemantic(ai, legal);
  if (bySemantic) return bySemantic;
  return decodeAction(ai.actionId);
}

function decodeAiActionBySemantic(ai: AiActionResult, legal: GameAction[]) {
  const type = ai.actionType?.toLowerCase().replace(/[-\s]/g, '_');
  if (!type) return undefined;

  if (type === 'discard') return legal.find((action) => action.type === 'DISCARD' && action.tile === ai.tile);
  if (type === 'pass') return legal.find((action) => action.type === 'PASS');
  if (['win', 'hu'].includes(type)) return legal.find((action) => action.type === 'WIN');
  if (['pong', 'peng'].includes(type)) return legal.find((action) => action.type === 'PONG');
  if (['chow_left', 'chi_left'].includes(type)) return legal.find((action) => action.type === 'CHOW_LEFT');
  if (['chow_middle', 'chi_middle'].includes(type)) return legal.find((action) => action.type === 'CHOW_MIDDLE');
  if (['chow_right', 'chi_right'].includes(type)) return legal.find((action) => action.type === 'CHOW_RIGHT');

  if (['chow', 'chi'].includes(type)) {
    return legal.find((action) => action.type.startsWith('CHOW') && (ai.tile === undefined || action.tile === ai.tile));
  }

  if (['kong_exposed', 'ming_kong', 'exposed_kong'].includes(type)) return legal.find((action) => action.type === 'KONG_EXPOSED');
  if (['kong_concealed', 'an_kong', 'concealed_kong'].includes(type)) return legal.find((action) => action.type === 'KONG_CONCEALED' && (ai.tile === undefined || action.tile === ai.tile));
  if (['kong_added', 'jia_kong', 'added_kong'].includes(type)) return legal.find((action) => action.type === 'KONG_ADDED' && (ai.tile === undefined || action.tile === ai.tile));
  if (['kong', 'gang'].includes(type)) {
    return legal.find((action) => action.type.startsWith('KONG') && (ai.tile === undefined || action.tile === ai.tile));
  }

  return undefined;
}

export const gameService = new GameService();
