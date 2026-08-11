import { env } from '../config/env.js';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerStatus {
  state: CircuitState;
  failures: number;
  threshold: number;
  openedAt: number | null;
}

/**
 * Simple circuit breaker for the AI inference service. Once consecutive
 * failures reach the threshold the breaker opens and requests fail fast
 * (avoiding a full HTTP timeout for every AI action). After the cooldown a
 * single probe is allowed; success closes the breaker, failure reopens it.
 */
export class AiCircuitBreaker {
  private failures = 0;
  private openedAt = 0;
  private state: CircuitState = 'CLOSED';

  constructor(
    private readonly threshold = env.AI_CIRCUIT_BREAKER_THRESHOLD,
    private readonly cooldownMs = env.AI_CIRCUIT_BREAKER_COOLDOWN_MS
  ) {}

  getState(): CircuitState {
    if (this.state === 'OPEN' && Date.now() - this.openedAt >= this.cooldownMs) this.state = 'HALF_OPEN';
    return this.state;
  }

  canAttempt(): boolean {
    const state = this.getState();
    return state !== 'OPEN';
  }

  onSuccess() {
    this.failures = 0;
    this.state = 'CLOSED';
  }

  onFailure() {
    this.failures += 1;
    if (this.state === 'HALF_OPEN' || this.failures >= this.threshold) {
      this.state = 'OPEN';
      this.openedAt = Date.now();
    }
  }

  status(): CircuitBreakerStatus {
    this.getState();
    return {
      state: this.state,
      failures: this.failures,
      threshold: this.threshold,
      openedAt: this.state === 'OPEN' ? this.openedAt : null
    };
  }
}

export const aiCircuitBreaker = new AiCircuitBreaker();
