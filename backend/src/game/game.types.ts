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
  lastDiscard?: { tile: number; fromPlayer: number; stepIndex: number };
  scores: number[];
  wallCount: number;
  updatedAt: number;
}

export interface CreateGameInput {
  roomId: string;
  gameId: string;
  ruleVersion: string;
  seed: string;
  players: Array<{ seatIndex: number; userId?: string; isAI: boolean; aiModel?: string }>;
}
