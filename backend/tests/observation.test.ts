import { describe, expect, it } from 'vitest';
import { buildObservation } from '../src/ai/observation.builder.js';
import { MockRuleEngine } from '../src/rules/rule-engine.js';

describe('observation builder', () => {
  it('returns a stable numeric vector without reading future wall contents', () => {
    const engine = new MockRuleEngine();
    const state = engine.createInitialState({
      roomId: 'r',
      gameId: 'g',
      ruleVersion: 'rule_v1',
      seed: 'seed',
      players: [0, 1, 2, 3].map((seatIndex) => ({ seatIndex, isAI: false }))
    });
    const obs = buildObservation(state, 0);
    expect(obs.length).toBeGreaterThan(100);
    expect(obs.every((value) => Number.isFinite(value))).toBe(true);
  });
});
