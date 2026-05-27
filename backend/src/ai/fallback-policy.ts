import type { GameAction } from '../rules/actions.js';

export function fallbackAction(legalActions: GameAction[]): GameAction {
  const win = legalActions.find((action) => action.type === 'WIN');
  if (win) return win;
  const pass = legalActions.find((action) => action.type === 'PASS');
  if (pass) return pass;
  return legalActions[0];
}
