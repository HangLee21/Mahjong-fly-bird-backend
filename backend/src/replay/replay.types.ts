export interface ReplayStep {
  gameId: string;
  stepIndex: number;
  playerIndex: number;
  action: unknown;
  legalActions: unknown;
  stateHashBefore: string;
  stateHashAfter: string;
  createdAt: Date;
}
