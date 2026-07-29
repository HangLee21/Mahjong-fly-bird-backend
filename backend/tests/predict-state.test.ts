import { describe, expect, it } from 'vitest';
import { buildPredictState } from '../src/ai/predict-state.builder.js';
import { MockRuleEngine } from '../src/rules/rule-engine.js';

describe('predict state builder', () => {
  it('builds the full AI-visible state payload for /predict', () => {
    const engine = new MockRuleEngine();
    const state = engine.createInitialState({
      roomId: 'r',
      gameId: 'g',
      ruleVersion: 'rule_v1',
      seed: 'seed',
      players: [0, 1, 2, 3].map((seatIndex) => ({ seatIndex, isAI: false }))
    });
    state.players[0].discards = [31];
    state.players[1].melds = [{ type: 'PONG', tiles: [3, 3, 3], fromPlayer: 0, stepIndex: 1 }];
    state.publicKongTiles = [3, 12];
    state.xiaoJiActiveAsWild = false;

    const payload = buildPredictState(state, 0);

    expect(payload.hands[0]).toEqual(state.players[0].hand);
    expect(payload.hands[1]).toEqual([]);
    expect(payload.discards[0]).toEqual([31]);
    expect(payload.melds[1][0]).toEqual({ type: 'pong', tiles: [3, 3, 3], from_player: 0, concealed: false });
    expect(payload.kong_pool).toEqual([3, 12]);
    expect(payload.xiaoji_disabled).toBe(true);
    expect(payload.wall_count).toBe(state.wall.length);
  });
});
