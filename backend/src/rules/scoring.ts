import type { GameState } from '../game/game.state.js';
import type { ScoreResult } from './rule.types.js';

export function mockScore(state: GameState): ScoreResult {
  return { scores: [...state.scores], reason: 'mock_wall_exhausted' };
}
