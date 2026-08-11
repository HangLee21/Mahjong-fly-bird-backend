import type { GameAction } from '../rules/actions.js';
import type { Meld } from './game.state.js';

export interface PublicPlayerView {
  seatIndex: number;
  userId?: string;
  isAI: boolean;
  handCount: number;
  melds: Meld[];
  discards: number[];
  status: string;
}

export interface PlayerGameView {
  gameId: string;
  roomId: string;
  ruleVersion: string;
  status: string;
  currentPlayer: number;
  dealer: number;
  roundIndex: number;
  stepIndex: number;
  self: PublicPlayerView & { hand: number[]; legalActions: GameAction[] };
  players: PublicPlayerView[];
  opponents?: PublicPlayerView[];
  legalActions?: GameAction[];
  lastDiscard?: { tile: number; fromPlayer: number; stepIndex: number };
  scores: number[];
  totalScores?: number[];
  currentRound?: number;
  maxRounds?: number;
  isFinalRound?: boolean;
  publicKongTiles?: number[];
  xiaoJiActiveAsWild?: boolean;
  /** Earliest actionable deadline (pending response or kong selection), ms epoch. */
  deadlineAt?: number;
  result?: unknown;
  wallCount: number;
  wallTilesRemaining?: number;
  updatedAt: number;
}

export interface CreateGameInput {
  roomId: string;
  gameId: string;
  ruleVersion: string;
  seed: string;
  currentRound?: number;
  maxRounds?: number;
  totalScores?: number[];
  dealer?: number;
  players: Array<{ seatIndex: number; userId?: string; isAI: boolean; aiModel?: string }>;
}
