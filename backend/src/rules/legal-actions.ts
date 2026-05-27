import type { GameState } from '../game/game.state.js';
import type { GameAction } from './actions.js';

export function getMockLegalActions(state: GameState, playerIndex: number): GameAction[] {
  if (state.status !== 'PLAYING') return [];
  if (state.currentPlayer !== playerIndex) return [{ type: 'PASS', actionId: 100 }];

  return state.players[playerIndex].hand.map((tile) => ({
    type: 'DISCARD',
    tile,
    actionId: tile
  }));
}
