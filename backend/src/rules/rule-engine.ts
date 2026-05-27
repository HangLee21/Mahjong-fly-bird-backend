import { DEFAULT_PLAYER_COUNT, INITIAL_HAND_SIZE } from '../config/constants.js';
import { nowMs } from '../common/time.js';
import { hashJson } from '../game/game.snapshot.js';
import { buildPlayerGameView } from '../game/game.serializer.js';
import type { GameState } from '../game/game.state.js';
import type { CreateGameInput } from '../game/game.types.js';
import type { GameAction } from './actions.js';
import { sameAction } from './actions.js';
import { getMockLegalActions } from './legal-actions.js';
import { mockScore } from './scoring.js';
import { shuffleWall } from './tile.js';
import { applyMockTransition } from './transition.js';
import type { RuleEngine } from './rule.types.js';
import { AppError } from '../common/errors.js';

export class MockRuleEngine implements RuleEngine {
  createInitialState(input: CreateGameInput): GameState {
    if (input.players.length !== DEFAULT_PLAYER_COUNT) {
      throw new AppError('RULE_ENGINE_ERROR', 'Mock rule engine requires exactly 4 players.');
    }

    const wall = shuffleWall(input.seed);
    const players = input.players.map((player) => ({
      ...player,
      hand: [] as number[],
      melds: [],
      discards: [],
      status: 'ACTIVE' as const,
      isReady: true
    }));

    for (let round = 0; round < INITIAL_HAND_SIZE; round += 1) {
      for (const player of players) player.hand.push(wall.shift()!);
    }
    players[0].hand.push(wall.shift()!);

    const ts = nowMs();
    return {
      gameId: input.gameId,
      roomId: input.roomId,
      ruleVersion: input.ruleVersion,
      seed: input.seed,
      status: 'PLAYING',
      players,
      wall,
      currentPlayer: 0,
      dealer: 0,
      roundIndex: 0,
      stepIndex: 0,
      scores: [0, 0, 0, 0],
      createdAt: ts,
      updatedAt: ts
    };
  }

  getLegalActions(state: GameState, playerIndex: number): GameAction[] {
    return getMockLegalActions(state, playerIndex);
  }

  applyAction(state: GameState, playerIndex: number, action: GameAction) {
    const legal = this.getLegalActions(state, playerIndex);
    if (!legal.some((item) => sameAction(item, action))) {
      throw new AppError('ILLEGAL_ACTION', 'Action is not legal in current state.');
    }
    return applyMockTransition(state, playerIndex, action);
  }

  buildPlayerView(state: GameState, playerIndex: number) {
    return buildPlayerGameView(state, playerIndex, this);
  }

  isTerminal(state: GameState) {
    return state.status === 'FINISHED';
  }

  score(state: GameState) {
    return mockScore(state);
  }

  hashState(state: GameState) {
    return hashJson(state);
  }
}

export const ruleEngine = new MockRuleEngine();
