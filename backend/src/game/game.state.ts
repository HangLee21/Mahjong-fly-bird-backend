import type { GameAction } from '../rules/actions.js';

export interface GameState {
  gameId: string;
  roomId: string;
  ruleVersion: string;
  seed: string;
  status: 'INIT' | 'PLAYING' | 'WAITING_RESPONSE' | 'FINISHED';
  players: PlayerState[];
  wall: number[];
  deadWall?: number[];
  currentPlayer: number;
  dealer: number;
  roundIndex: number;
  stepIndex: number;
  lastAction?: GameAction;
  lastDiscard?: {
    tile: number;
    fromPlayer: number;
    stepIndex: number;
  };
  pendingResponses?: PendingResponse[];
  scores: number[];
  createdAt: number;
  updatedAt: number;
}

export interface PlayerState {
  seatIndex: number;
  userId?: string;
  isAI: boolean;
  aiModel?: string;
  hand: number[];
  melds: Meld[];
  discards: number[];
  status: 'ACTIVE' | 'OFFLINE' | 'LEFT';
  isReady?: boolean;
}

export interface Meld {
  type: 'CHOW' | 'PONG' | 'KONG_EXPOSED' | 'KONG_CONCEALED' | 'KONG_ADDED';
  tiles: number[];
  fromPlayer?: number;
  stepIndex: number;
}

export interface PendingResponse {
  playerIndex: number;
  availableActions: GameAction[];
  priority: number;
  deadlineAt?: number;
}
