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
  publicKongTiles?: number[];
  xiaoJiActiveAsWild?: boolean;
  kongCount?: number;
  lastDraw?: {
    playerIndex: number;
    tile: number;
    source: 'WALL' | 'PUBLIC_KONG';
    stepIndex: number;
  };
  lastKong?: {
    playerIndex: number;
    stepIndex: number;
    kind: Meld['type'];
  };
  pendingKongSelection?: {
    playerIndex: number;
    kind: Meld['type'];
  };
  afterKongDiscardFrom?: number;
  specialRuns?: Array<{
    honorDiscards: number;
    yaojiuDiscards: number;
    containsXiaoJiDiscard: boolean;
    brokenByMeld: boolean;
  }>;
  currentRound?: number;
  maxRounds?: number;
  totalScores?: number[];
  result?: unknown;
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
  /** Index in `tiles` of the tile claimed from another player's discard. */
  claimedIndex?: number;
  fromPlayer?: number;
  stepIndex: number;
  containsXiaoJiAsWild?: boolean;
}

export interface PendingResponse {
  playerIndex: number;
  availableActions: GameAction[];
  priority: number;
  deadlineAt?: number;
}
