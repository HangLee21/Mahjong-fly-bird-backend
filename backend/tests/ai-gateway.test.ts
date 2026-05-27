import { describe, expect, it, vi } from 'vitest';
import { HttpAiGateway } from '../src/ai/ai-gateway.js';
import { fallbackAction } from '../src/ai/fallback-policy.js';

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

  it('fallback prefers win then pass then first legal action', () => {
    expect(fallbackAction([{ type: 'PASS', actionId: 100 }, { type: 'WIN', actionId: 101 }]).type).toBe('WIN');
    expect(fallbackAction([{ type: 'PASS', actionId: 100 }]).type).toBe('PASS');
    expect(fallbackAction([{ type: 'DISCARD', tile: 3, actionId: 3 }]).actionId).toBe(3);
  });
});
