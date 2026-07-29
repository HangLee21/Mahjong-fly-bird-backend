import { describe, expect, it, vi } from 'vitest';
import { HttpAiGateway } from '../src/ai/ai-gateway.js';
import { fallbackAction } from '../src/ai/fallback-policy.js';
import { MockRuleEngine } from '../src/rules/rule-engine.js';

describe('AI gateway and fallback', () => {
  it('uses model action from service', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ action: 5, model_version: 'm1', confidence: 0.7 }), { status: 200 }))
    );

    const result = await new HttpAiGateway().requestAction({
      roomId: 'r',
      gameId: 'g',
      playerIndex: 0,
      modelVersion: 'm0',
      observation: [0],
      legalActions: [5]
    });

    expect(result.actionId).toBe(5);
    expect(result.fallbackUsed).toBe(false);
    vi.unstubAllGlobals();
  });

  it('marks service-side fallback responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ action: 100, model_version: 'v3-lite', fallback: true }), { status: 200 }))
    );

    const result = await new HttpAiGateway().requestAction({
      roomId: 'r',
      gameId: 'g',
      playerIndex: 0,
      modelVersion: 'v3-lite',
      observation: [0],
      legalActions: [100]
    });

    expect(result.actionId).toBe(100);
    expect(result.modelVersion).toBe('v3-lite');
    expect(result.fallbackUsed).toBe(true);
    vi.unstubAllGlobals();
  });

  it('prefers /predict when a full game state is provided', async () => {
    const engine = new MockRuleEngine();
    const state = engine.createInitialState({
      roomId: 'r',
      gameId: 'g',
      ruleVersion: 'rule_v1',
      seed: 'seed',
      players: [0, 1, 2, 3].map((seatIndex) => ({ seatIndex, isAI: false }))
    });
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.player_id).toBe(0);
      expect(body.state.hands[0]).toEqual(state.players[0].hand);
      expect(body.state.discards).toHaveLength(4);
      return new Response(JSON.stringify({ action: 31, action_type: 'discard', tile: 31, fallback_used: false }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await new HttpAiGateway().requestAction({
      roomId: 'r',
      gameId: 'g',
      playerIndex: 0,
      modelVersion: 'v3-lite',
      observation: [0],
      legalActions: [31],
      state
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0][0])).toContain('/predict');
    expect(result.actionType).toBe('discard');
    expect(result.tile).toBe(31);
    expect(result.fallbackUsed).toBe(false);
    vi.unstubAllGlobals();
  });

  it('fallback prefers win then pass then first legal action', () => {
    expect(fallbackAction([{ type: 'PASS', actionId: 100 }, { type: 'WIN', actionId: 101 }]).type).toBe('WIN');
    expect(fallbackAction([{ type: 'PASS', actionId: 100 }]).type).toBe('PASS');
    expect(fallbackAction([{ type: 'DISCARD', tile: 3, actionId: 3 }]).actionId).toBe(3);
  });
});
