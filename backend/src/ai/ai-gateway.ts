import { performance } from 'node:perf_hooks';
import { env } from '../config/env.js';
import { AppError } from '../common/errors.js';
import type { AiActionRequest, AiActionResult } from './ai.types.js';
import { buildPredictState } from './predict-state.builder.js';
import { aiCircuitBreaker } from './ai-circuit-breaker.js';

export interface AiGateway {
  requestAction(input: AiActionRequest): Promise<AiActionResult>;
}

export class HttpAiGateway implements AiGateway {
  async requestAction(input: AiActionRequest): Promise<AiActionResult> {
    if (!aiCircuitBreaker.canAttempt()) {
      throw new AppError('AI_SERVICE_ERROR', 'AI service is temporarily unavailable (circuit open).', 503);
    }
    const startedAt = performance.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.AI_REQUEST_TIMEOUT_MS);

    try {
      if (input.state) {
        const response = await fetch(`${env.AI_SERVICE_URL}/predict`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            player_id: input.playerIndex,
            deterministic: true,
            state: buildPredictState(input.state, input.playerIndex)
          }),
          signal: controller.signal
        });

        if (response.ok) {
          const data = (await response.json()) as {
            action?: number;
            action_type?: string;
            tile?: number | null;
            action_text?: string;
            fallback_used?: boolean;
            latency_ms?: number;
          };
          aiCircuitBreaker.onSuccess();
          return {
            actionId: typeof data.action === 'number' ? data.action : -1,
            actionType: data.action_type,
            tile: data.tile ?? undefined,
            actionText: data.action_text,
            modelVersion: input.modelVersion,
            fallbackUsed: data.fallback_used === true,
            latencyMs: Math.round(data.latency_ms ?? performance.now() - startedAt)
          };
        }

        if (response.status !== 404 && response.status !== 405) {
          throw new Error(`AI predict service returned ${response.status}: ${await response.text()}`);
        }
      }

      const response = await fetch(`${env.AI_SERVICE_URL}/ai/act`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          room_id: input.roomId,
          game_id: input.gameId,
          player_id: input.playerIndex,
          model_version: input.modelVersion,
          observation: input.observation,
          legal_actions: input.legalActions,
          observation_version: env.DEFAULT_OBSERVATION_VERSION,
          action_version: env.DEFAULT_ACTION_VERSION,
          rule_version: env.DEFAULT_RULE_VERSION
        }),
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`AI service returned ${response.status}`);
      const data = (await response.json()) as { action: number; model_version?: string; confidence?: number; fallback?: boolean };
      aiCircuitBreaker.onSuccess();
      return {
        actionId: data.action,
        modelVersion: data.model_version ?? input.modelVersion,
        confidence: data.confidence,
        fallbackUsed: data.fallback === true,
        latencyMs: Math.round(performance.now() - startedAt)
      };
    } catch (error) {
      aiCircuitBreaker.onFailure();
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const aiGateway = new HttpAiGateway();
