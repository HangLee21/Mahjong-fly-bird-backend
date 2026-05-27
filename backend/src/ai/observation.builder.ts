import { env } from '../config/env.js';
import { TILE_TYPE_COUNT } from '../config/constants.js';
import type { GameState } from '../game/game.state.js';
import { countTiles } from '../rules/tile.js';

export const observationVersion = env.DEFAULT_OBSERVATION_VERSION;

export function buildObservation(state: GameState, playerIndex: number): number[] {
  const player = state.players[playerIndex];
  const ownHand = countTiles(player.hand);
  const selfMeldTiles = countTiles(player.melds.flatMap((meld) => meld.tiles));
  const discards = countTiles(state.players.flatMap((item) => item.discards));
  const openMelds = countTiles(state.players.flatMap((item) => item.melds.flatMap((meld) => meld.tiles)));
  const visible = countTiles([...state.players.flatMap((item) => item.discards), ...state.players.flatMap((item) => item.melds.flatMap((meld) => meld.tiles)), ...player.hand]);
  const remainingVisibleEstimate = visible.map((count) => Math.max(0, 4 - count));
  const scores = state.scores.map((score) => score / 1000);
  const oneHot = (index: number, size: number) => Array.from({ length: size }, (_, i) => (i === index ? 1 : 0));
  const lastDiscard = Array.from({ length: TILE_TYPE_COUNT }, (_, i) => (state.lastDiscard?.tile === i ? 1 : 0));

  return [
    ...ownHand,
    ...selfMeldTiles,
    ...discards,
    ...openMelds,
    ...remainingVisibleEstimate,
    ...scores,
    ...oneHot(state.dealer, state.players.length),
    ...oneHot(state.currentPlayer, state.players.length),
    ...lastDiscard,
    state.wall.length / 136
  ];
}
