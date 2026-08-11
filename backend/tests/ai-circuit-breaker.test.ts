import { describe, expect, it, vi } from 'vitest';
import { AiCircuitBreaker } from '../src/ai/ai-circuit-breaker.js';
import { HttpAiGateway } from '../src/ai/ai-gateway.js';
import { aiCircuitBreaker } from '../src/ai/ai-circuit-breaker.js';

describe('AI circuit breaker', () => {
  it('opens after the configured consecutive failures and fails fast', () => {
    vi.useFakeTimers();
    const breaker = new AiCircuitBreaker(3, 30000);
    expect(breaker.canAttempt()).toBe(true);
    breaker.onFailure();
    breaker.onFailure();
    expect(breaker.canAttempt()).toBe(true);
    breaker.onFailure();
    expect(breaker.canAttempt()).toBe(false);
    expect(breaker.status().state).toBe('OPEN');
    vi.useRealTimers();
  });

  it('allows a probe after the cooldown and closes on success', () => {
    vi.useFakeTimers();
    const breaker = new AiCircuitBreaker(2, 1000);
    breaker.onFailure();
    breaker.onFailure();
    expect(breaker.canAttempt()).toBe(false);
    vi.advanceTimersByTime(1001);
    expect(breaker.canAttempt()).toBe(true);
    breaker.onSuccess();
    expect(breaker.status().state).toBe('CLOSED');
    expect(breaker.canAttempt()).toBe(true);
    vi.useRealTimers();
  });

  it('reopens after a failed half-open probe', () => {
    vi.useFakeTimers();
    const breaker = new AiCircuitBreaker(2, 1000);
    breaker.onFailure();
    breaker.onFailure();
    vi.advanceTimersByTime(1001);
    expect(breaker.canAttempt()).toBe(true);
    breaker.onFailure();
    expect(breaker.canAttempt()).toBe(false);
    expect(breaker.status().state).toBe('OPEN');
    vi.useRealTimers();
  });

  it('resets the failure count on success', () => {
    const breaker = new AiCircuitBreaker(3, 1000);
    breaker.onFailure();
    breaker.onFailure();
    breaker.onSuccess();
    breaker.onFailure();
    expect(breaker.status().failures).toBe(1);
    expect(breaker.canAttempt()).toBe(true);
  });

  it('gateway fails fast while the breaker is open without calling fetch', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    // Open the shared breaker used by the gateway.
    aiCircuitBreaker.onFailure();
    aiCircuitBreaker.onFailure();
    aiCircuitBreaker.onFailure();
    expect(aiCircuitBreaker.status().state).toBe('OPEN');

    await expect(
      new HttpAiGateway().requestAction({
        roomId: 'r',
        gameId: 'g',
        playerIndex: 0,
        modelVersion: 'v3-lite',
        observation: [0],
        legalActions: [0]
      })
    ).rejects.toMatchObject({ code: 'AI_SERVICE_ERROR', statusCode: 503 });
    expect(fetchMock).not.toHaveBeenCalled();

    aiCircuitBreaker.onSuccess();
    vi.unstubAllGlobals();
  });
});
