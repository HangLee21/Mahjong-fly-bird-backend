import type { GameState, Meld, PendingResponse } from '../game/game.state.js';
import type { CreateGameInput, PlayerGameView } from '../game/game.types.js';
import type { GameAction } from './actions.js';

export interface RuleEngine {
  createInitialState(input: CreateGameInput): GameState;
  getLegalActions(state: GameState, playerIndex: number): GameAction[];
  applyAction(state: GameState, playerIndex: number, action: GameAction): RuleResult;
  buildPlayerView(state: GameState, playerIndex: number): PlayerGameView;
  isTerminal(state: GameState): boolean;
  score(state: GameState): ScoreResult;
  hashState(state: GameState): string;
}

export interface RuleResult {
  nextState: GameState;
  events: GameEvent[];
  scoreResult?: ScoreResult;
}

export interface ScoreResult {
  scores: number[];
  reason: string;
}

export type GameEvent =
  | { type: 'TILE_DRAWN'; playerIndex: number }
  | { type: 'TILE_DISCARDED'; playerIndex: number; tile: number }
  | { type: 'MELD_CREATED'; playerIndex: number; meld: Meld }
  | { type: 'WIN_DECLARED'; playerIndex: number }
  | { type: 'SCORE_SETTLED'; result: ScoreResult }
  | { type: 'TURN_CHANGED'; currentPlayer: number }
  | { type: 'WAITING_RESPONSE'; responses: PendingResponse[] };
