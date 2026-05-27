import { describe, expect, it } from 'vitest';
import { MockRuleEngine } from '../src/rules/rule-engine.js';

function input() {
  return {
    roomId: 'room_test',
    gameId: 'game_test',
    ruleVersion: 'rule_v1',
    seed: 'seed_test',
    players: [0, 1, 2, 3].map((seatIndex) => ({ seatIndex, isAI: seatIndex !== 0, userId: seatIndex === 0 ? 'u1' : undefined }))
  };
}

describe('MockRuleEngine', () => {
  it('creates a playable initial state', () => {
    const engine = new MockRuleEngine();
    const state = engine.createInitialState(input());
    expect(state.status).toBe('PLAYING');
    expect(state.players).toHaveLength(4);
    expect(state.players[0].hand).toHaveLength(14);
    expect(state.players[1].hand).toHaveLength(13);
    expect(engine.getLegalActions(state, 0).length).toBeGreaterThan(0);
  });

  it('applies discard without mutating previous state', () => {
    const engine = new MockRuleEngine();
    const state = engine.createInitialState(input());
    const tile = state.players[0].hand[0];
    const result = engine.applyAction(state, 0, { type: 'DISCARD', tile, actionId: tile });
    expect(result.nextState.stepIndex).toBe(1);
    expect(result.nextState.currentPlayer).toBe(1);
    expect(state.stepIndex).toBe(0);
    expect(state.players[0].hand).toHaveLength(14);
  });

  it('hashes equivalent state deterministically', () => {
    const engine = new MockRuleEngine();
    const a = engine.createInitialState(input());
    const b = engine.createInitialState(input());
    expect(engine.hashState(a)).toBe(engine.hashState(b));
  });

  it('player view does not expose other hands', () => {
    const engine = new MockRuleEngine();
    const state = engine.createInitialState(input());
    const view = engine.buildPlayerView(state, 0);
    expect(view.self.hand).toEqual(state.players[0].hand);
    expect(view.players[1].handCount).toBe(state.players[1].hand.length);
    expect('hand' in view.players[1]).toBe(false);
  });
});
