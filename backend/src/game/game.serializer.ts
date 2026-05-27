import type { RuleEngine } from '../rules/rule.types.js';
import type { GameState, PlayerState } from './game.state.js';
import type { PlayerGameView, PublicPlayerView } from './game.types.js';

export function publicPlayerView(player: PlayerState): PublicPlayerView {
  return {
    seatIndex: player.seatIndex,
    userId: player.userId,
    isAI: player.isAI,
    handCount: player.hand.length,
    melds: player.melds,
    discards: player.discards,
    status: player.status
  };
}

export function buildPlayerGameView(
  state: GameState,
  playerIndex: number,
  ruleEngine: Pick<RuleEngine, 'getLegalActions'>
): PlayerGameView {
  const player = state.players[playerIndex];
  return {
    gameId: state.gameId,
    roomId: state.roomId,
    ruleVersion: state.ruleVersion,
    status: state.status,
    currentPlayer: state.currentPlayer,
    dealer: state.dealer,
    roundIndex: state.roundIndex,
    stepIndex: state.stepIndex,
    self: {
      ...publicPlayerView(player),
      hand: [...player.hand],
      legalActions: ruleEngine.getLegalActions(state, playerIndex)
    },
    players: state.players.map(publicPlayerView),
    lastDiscard: state.lastDiscard,
    scores: [...state.scores],
    wallCount: state.wall.length,
    updatedAt: state.updatedAt
  };
}
