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
  winnerIndexes?: number[];
  loserIndexes?: number[];
  dealer?: number;
  isSelfDraw?: boolean;
  isDraw?: boolean;
  baseScore?: number;
  cappedFan?: number;
  fanItems?: Array<{ code: string; name: string; fan: number; points: number; description?: string }>;
  scoreDelta?: number[];
  title?: string;
  description?: string;
  /** 每个赢家的结算明细（谁胡、进张、牌型、原因）。 */
  winnerDetails?: WinnerDetail[];
}

export type WinSource = 'SELF_DRAW' | 'DISCARD' | 'ROB_KONG';

export interface WinnerDetail {
  winner: number;
  /** 进张：自摸的摸牌 / 点炮的炮牌 / 抢杠的杠牌。 */
  tile?: number;
  /** 胡牌时的全部手牌（含进张），按牌值升序。 */
  hand: number[];
  /** 胡牌时的副露。 */
  melds: Array<{ type: string; tiles: number[] }>;
  /** 牌型标题，如 清一色+无鸡、四小鸡。 */
  title: string;
  source: WinSource;
  fan: number;
  points: number;
  fanItems: Array<{ code: string; name: string; fan: number; points: number; description?: string }>;
}

export type GameEvent =
  | { type: 'TILE_DRAWN'; playerIndex: number }
  | { type: 'TILE_DISCARDED'; playerIndex: number; tile: number }
  | { type: 'MELD_CREATED'; playerIndex: number; meld: Meld }
  | { type: 'WIN_DECLARED'; playerIndex: number }
  | { type: 'SCORE_SETTLED'; result: ScoreResult }
  | { type: 'TURN_CHANGED'; currentPlayer: number }
  | { type: 'WAITING_RESPONSE'; responses: PendingResponse[] }
  | { type: 'ROUND_REDEALT' };
