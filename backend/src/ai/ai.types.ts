export interface AiActionRequest {
  roomId: string;
  gameId: string;
  playerIndex: number;
  modelVersion: string;
  observation: number[];
  legalActions: number[];
}

export interface AiActionResult {
  actionId: number;
  modelVersion: string;
  confidence?: number;
  fallbackUsed: boolean;
  latencyMs: number;
}
