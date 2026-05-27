import { AppError } from '../common/errors.js';
import { nowMs } from '../common/time.js';
import type { GameState } from '../game/game.state.js';
import type { GameAction } from './actions.js';
import type { GameEvent, RuleResult } from './rule.types.js';
import { mockScore } from './scoring.js';

export function applyMockTransition(state: GameState, playerIndex: number, action: GameAction): RuleResult {
  const nextState: GameState = structuredClone(state);
  const events: GameEvent[] = [];
  const player = nextState.players[playerIndex];

  if (action.type === 'PASS') {
    nextState.stepIndex += 1;
    nextState.lastAction = action;
    nextState.updatedAt = nowMs();
    return { nextState, events };
  }

  if (action.type !== 'DISCARD' || action.tile === undefined) {
    throw new AppError('ILLEGAL_ACTION', 'Mock rule engine only supports DISCARD and PASS.');
  }

  const handIndex = player.hand.indexOf(action.tile);
  if (handIndex < 0) throw new AppError('ILLEGAL_ACTION', 'Tile is not in player hand.');

  player.hand.splice(handIndex, 1);
  player.discards.push(action.tile);
  nextState.lastAction = action;
  nextState.lastDiscard = { tile: action.tile, fromPlayer: playerIndex, stepIndex: nextState.stepIndex };
  events.push({ type: 'TILE_DISCARDED', playerIndex, tile: action.tile });

  const nextPlayer = (playerIndex + 1) % nextState.players.length;
  nextState.currentPlayer = nextPlayer;
  events.push({ type: 'TURN_CHANGED', currentPlayer: nextPlayer });

  if (nextState.wall.length > 0) {
    const drawn = nextState.wall.shift();
    if (drawn !== undefined) {
      nextState.players[nextPlayer].hand.push(drawn);
      events.push({ type: 'TILE_DRAWN', playerIndex: nextPlayer });
    }
  }

  nextState.stepIndex += 1;
  nextState.updatedAt = nowMs();

  if (nextState.wall.length === 0) {
    nextState.status = 'FINISHED';
    const result = mockScore(nextState);
    events.push({ type: 'SCORE_SETTLED', result });
    return { nextState, events, scoreResult: result };
  }

  return { nextState, events };
}
