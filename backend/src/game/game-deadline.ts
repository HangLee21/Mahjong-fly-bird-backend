import type { GameState } from './game.state.js';
import type { GameAction } from '../rules/actions.js';
import { encodeAction } from '../rules/actions.js';
import { env } from '../config/env.js';

export type OverdueAction = { playerIndex: number; action: GameAction };

/**
 * Returns the next action that should be auto-applied because its response
 * deadline has passed: an overdue pending response becomes a PASS, an overdue
 * kong-tile selection auto-takes the first public kong tile.
 */
export function nextOverdueAction(state: GameState, now = Date.now()): OverdueAction | null {
  if (state.status === 'WAITING_RESPONSE') {
    const overdue = (state.pendingResponses ?? []).find(
      (pending) => pending.deadlineAt !== undefined && pending.deadlineAt <= now
    );
    if (overdue) {
      return { playerIndex: overdue.playerIndex, action: { type: 'PASS', actionId: encodeAction({ type: 'PASS' }) } };
    }
  }
  if (state.pendingKongSelection?.deadlineAt !== undefined && state.pendingKongSelection.deadlineAt <= now) {
    const tile = (state.publicKongSlots ?? [])[0]?.visible;
    if (tile !== undefined) {
      return {
        playerIndex: state.pendingKongSelection.playerIndex,
        action: { type: 'SELECT_KONG_TILE', tile, actionId: encodeAction({ type: 'SELECT_KONG_TILE' }) }
      };
    }
  }
  // A stuck AI turn (e.g. an interrupted advance chain) must never block the
  // table forever: after the AI-turn timeout, force a legal fallback discard.
  if (state.status === 'PLAYING') {
    const player = state.players[state.currentPlayer];
    if (player?.isAI && now - state.updatedAt >= env.AI_TURN_TIMEOUT_MS) {
      const tile = player.hand[0];
      if (tile !== undefined) {
        return {
          playerIndex: player.seatIndex,
          action: { type: 'DISCARD', tile, actionId: encodeAction({ type: 'DISCARD', tile }) }
        };
      }
    }
  }
  return null;
}

/**
 * Earliest actionable deadline in the state, used to schedule the room timer.
 */
export function earliestDeadline(state: GameState): number | undefined {
  if (state.status === 'WAITING_RESPONSE') {
    const deadlines = (state.pendingResponses ?? [])
      .map((pending) => pending.deadlineAt)
      .filter((deadline): deadline is number => deadline !== undefined);
    if (deadlines.length > 0) return Math.min(...deadlines);
  }
  if (state.pendingKongSelection?.deadlineAt !== undefined) return state.pendingKongSelection.deadlineAt;
  // Schedule a watchdog for AI turns so a stuck AI is force-moved.
  if (state.status === 'PLAYING') {
    const player = state.players[state.currentPlayer];
    if (player?.isAI) return state.updatedAt + env.AI_TURN_TIMEOUT_MS;
  }
  return undefined;
}

/**
 * Action to auto-resolve a specific player's blocking state immediately
 * (used on disconnect): pass an open response, take a kong tile, or discard
 * the first hand tile when it is their turn.
 */
export function autoResolveAction(state: GameState, playerIndex: number): OverdueAction | null {
  if (state.status === 'WAITING_RESPONSE') {
    const pending = (state.pendingResponses ?? []).find((item) => item.playerIndex === playerIndex);
    if (pending) return { playerIndex, action: { type: 'PASS', actionId: encodeAction({ type: 'PASS' }) } };
  }
  if (state.pendingKongSelection?.playerIndex === playerIndex) {
    const tile = (state.publicKongSlots ?? [])[0]?.visible;
    if (tile !== undefined) {
      return {
        playerIndex,
        action: { type: 'SELECT_KONG_TILE', tile, actionId: encodeAction({ type: 'SELECT_KONG_TILE' }) }
      };
    }
  }
  if (state.status === 'PLAYING' && state.currentPlayer === playerIndex) {
    const firstTile = state.players[playerIndex]?.hand[0];
    if (firstTile !== undefined) {
      return {
        playerIndex,
        action: { type: 'DISCARD', tile: firstTile, actionId: encodeAction({ type: 'DISCARD', tile: firstTile }) }
      };
    }
  }
  return null;
}
