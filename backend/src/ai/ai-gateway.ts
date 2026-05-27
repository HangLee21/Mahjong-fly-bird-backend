import { performance } from 'node:perf_hooks';
import { env } from '../config/env.js';
import type { AiActionRequest, AiActionResult } from './ai.types.js';

export interface AiGateway {
  requestAction(input: AiActionRequest): Promise<AiActionResult>;
}

export class HttpAiGateway implements AiGateway {
  async requestAction(input: AiActionRequest): Promise<AiActionResult> {
    const startedAt = performance.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.AI_REQUEST_TIMEOUT_MS);

    try {
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
      const data = (await response.json()) as { action: number; model_version?: string; confidence?: number };
      return {
        actionId: data.action,
        modelVersion: data.model_version ?? input.modelVersion,
        confidence: data.confidence,
        fallbackUsed: false,
        latencyMs: Math.round(performance.now() - startedAt)
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const aiGateway = new HttpAiGateway();
