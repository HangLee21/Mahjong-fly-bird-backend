import type { GameState, Meld } from '../game/game.state.js';

type PredictMeld = {
  type: 'chow' | 'pong' | 'kong';
  tiles: number[];
  from_player: number | null;
  concealed: boolean;
};

export type PredictStatePayload = {
  hands: number[][];
  discards: number[][];
  melds: PredictMeld[][];
  scores: number[];
  dealer: number;
  current_player: number;
  phase: 'discard' | 'claim';
  wall_count: number;
  kong_pool: number[];
  last_discard: number | null;
  last_discard_player: number | null;
  pending: {
    discarder: number;
    tile: number;
    responders: number[];
    index: number;
    kind: 'discard' | 'rob_kong';
    kong_meld_index?: number;
    kong_use_wildcard?: boolean;
  } | null;
  xiaoji_disabled: boolean;
};

export function buildPredictState(state: GameState, playerIndex: number): PredictStatePayload {
  const phase = state.status === 'WAITING_RESPONSE' ? 'claim' : 'discard';
  const responders = (state.pendingResponses ?? []).map((pending) => pending.playerIndex);
  const pending =
    phase === 'claim' && state.lastDiscard
      ? {
          discarder: state.lastDiscard.fromPlayer,
          tile: state.lastDiscard.tile,
          responders,
          index: Math.max(0, responders.indexOf(playerIndex)),
          kind: 'discard' as const
        }
      : null;

  return {
    hands: state.players.map((player) => (player.seatIndex === playerIndex ? [...player.hand] : [])),
    discards: state.players.map((player) => [...player.discards]),
    melds: state.players.map((player) => player.melds.map(toPredictMeld)),
    scores: [...state.scores],
    dealer: state.dealer,
    current_player: state.currentPlayer,
    phase,
    wall_count: state.wall.length,
    kong_pool: [...(state.publicKongTiles ?? [])],
    last_discard: state.lastDiscard?.tile ?? null,
    last_discard_player: state.lastDiscard?.fromPlayer ?? null,
    pending,
    xiaoji_disabled: state.xiaoJiActiveAsWild === false
  };
}

function toPredictMeld(meld: Meld): PredictMeld {
  return {
    type: meld.type === 'CHOW' ? 'chow' : meld.type === 'PONG' ? 'pong' : 'kong',
    tiles: [...meld.tiles],
    from_player: meld.fromPlayer ?? null,
    concealed: meld.type === 'KONG_CONCEALED'
  };
}
