import type { GameState } from '../game/game.state.js';

export interface AiActionRequest {
  roomId: string;
  gameId: string;
  playerIndex: number;
  modelVersion: string;
  observation: number[];
  legalActions: number[];
  state?: GameState;
}

export interface AiActionResult {
  actionId: number;
  actionType?: string;
  tile?: number;
  actionText?: string;
  modelVersion: string;
  confidence?: number;
  fallbackUsed: boolean;
  latencyMs: number;
}
