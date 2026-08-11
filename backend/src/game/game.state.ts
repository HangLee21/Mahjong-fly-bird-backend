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
  /** Dice values used for the initial wall placement (开牌点数). */
  dice?: { first: number; second: number };
  /**
   * Two public kong slots (公开杠牌). Each slot keeps the currently visible
   * tile plus the hidden tile below it in the same stack, when still reserved.
   */
  publicKongSlots?: Array<{ visible: number; hidden?: number }>;
  xiaoJiActiveAsWild?: boolean;
  kongCount?: number;
  /** Consecutive kong replacement draws per player on the current turn (双杠上花). */
  kongDrawStreak?: number[];
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
    deadlineAt?: number;
  };
  afterKongDiscardFrom?: number;
  specialRuns?: Array<{
    honorDiscards: number;
    yaojiuDiscards: number;
    containsXiaoJiDiscard: boolean;
    brokenByMeld: boolean;
  }>;
  /** Same-turn furiten (振听) state per player, reset when the player's own turn starts. */
  furiten?: Array<{
    passedWinTiles: number[];
    refusedXiaoJiWin: boolean;
    passedPongTiles: number[];
  }>;
  /** 四风连打 tracking for the first round of discards. */
  firstRound?: {
    count: number;
    tile?: number;
    broken: boolean;
  };
  /** 包牌 (bao pai): payer is responsible for the protected player's win. */
  baoPai?: Array<{
    protectedPlayer: number;
    payer: number;
    kind: 'BIG_THREE_DRAGONS' | 'BIG_FOUR_WINDS';
  }>;
  /** Hand count correction (相公): positive means too many tiles, negative means too few. */
  handErrors?: number[];
  /** Rob-kong (抢杠) is pending for an added kong. */
  pendingRobKong?: { tile: number; fromPlayer: number };
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
