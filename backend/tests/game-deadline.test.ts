import { describe, expect, it } from 'vitest';
import { nextOverdueAction, earliestDeadline, autoResolveAction } from '../src/game/game-deadline.js';
import { encodeAction } from '../src/rules/actions.js';
import type { GameState } from '../src/game/game.state.js';

function baseState(overrides: Partial<GameState> = {}): GameState {
  return {
    gameId: 'g',
    roomId: 'r',
    ruleVersion: 'v',
    seed: 's',
    status: 'PLAYING',
    players: [0, 1, 2, 3].map((seatIndex) => ({
      seatIndex,
      isAI: false,
      hand: [],
      melds: [],
      discards: [],
      status: 'ACTIVE' as const
    })),
    wall: [],
    currentPlayer: 0,
    dealer: 0,
    roundIndex: 0,
    stepIndex: 0,
    scores: [0, 0, 0, 0],
    createdAt: 0,
    updatedAt: 0,
    ...overrides
  };
}

describe('game deadline helpers', () => {
  it('returns a PASS for an overdue pending response', () => {
    const s = baseState({
      status: 'WAITING_RESPONSE',
      pendingResponses: [
        { playerIndex: 1, availableActions: [], priority: 2, deadlineAt: 900 },
        { playerIndex: 2, availableActions: [], priority: 2, deadlineAt: 1500 }
      ]
    });
    expect(nextOverdueAction(s, 1000)).toEqual({ playerIndex: 1, action: { type: 'PASS', actionId: 100 } });
  });

  it('returns null when nothing is overdue', () => {
    const s = baseState({
      status: 'WAITING_RESPONSE',
      pendingResponses: [{ playerIndex: 1, availableActions: [], priority: 2, deadlineAt: 1500 }]
    });
    expect(nextOverdueAction(s, 1000)).toBeNull();
  });

  it('auto-takes the first public kong tile for an overdue kong selection', () => {
    const s = baseState({
      pendingKongSelection: { playerIndex: 2, kind: 'KONG_CONCEALED', deadlineAt: 900 },
      publicKongSlots: [
        { visible: 7, hidden: 5 },
        { visible: 9 }
      ]
    });
    expect(nextOverdueAction(s, 1000)).toEqual({
      playerIndex: 2,
      action: { type: 'SELECT_KONG_TILE', tile: 7, actionId: 109 }
    });
  });

  it('forces a fallback discard when an AI turn exceeds the AI-turn timeout', () => {
    const s = baseState({
      status: 'PLAYING',
      currentPlayer: 1,
      updatedAt: 5000,
      players: [0, 1, 2, 3].map((seatIndex) => ({
        seatIndex,
        isAI: seatIndex === 1,
        hand: seatIndex === 1 ? [18, 5, 7] : [],
        melds: [],
        discards: [],
        status: 'ACTIVE' as const
      }))
    });
    const overdue = nextOverdueAction(s, 5000 + 26000);
    expect(overdue).toEqual({
      playerIndex: 1,
      action: { type: 'DISCARD', tile: 18, actionId: encodeAction({ type: 'DISCARD', tile: 18 }) }
    });
  });

  it('does not force a discard for an AI turn within the timeout', () => {
    const s = baseState({
      status: 'PLAYING',
      currentPlayer: 1,
      updatedAt: 5000,
      players: [0, 1, 2, 3].map((seatIndex) => ({
        seatIndex,
        isAI: seatIndex === 1,
        hand: seatIndex === 1 ? [18] : [],
        melds: [],
        discards: [],
        status: 'ACTIVE' as const
      }))
    });
    expect(nextOverdueAction(s, 5000 + 10000)).toBeNull();
  });

  it('schedules an AI-turn watchdog deadline for AI turns only', () => {
    const s = baseState({
      status: 'PLAYING',
      currentPlayer: 2,
      updatedAt: 1234,
      players: [0, 1, 2, 3].map((seatIndex) => ({
        seatIndex,
        isAI: seatIndex === 2,
        hand: [],
        melds: [],
        discards: [],
        status: 'ACTIVE' as const
      }))
    });
    expect(earliestDeadline(s)).toBe(1234 + 20000);
    expect(earliestDeadline(baseState({ status: 'PLAYING', currentPlayer: 0 }))).toBeUndefined();
  });

  it('earliestDeadline picks the minimum pending response deadline', () => {
    const s = baseState({
      status: 'WAITING_RESPONSE',
      pendingResponses: [
        { playerIndex: 1, availableActions: [], priority: 2, deadlineAt: 1500 },
        { playerIndex: 2, availableActions: [], priority: 2, deadlineAt: 900 }
      ]
    });
    expect(earliestDeadline(s)).toBe(900);
  });

  it('autoResolveAction passes a specific pending player immediately', () => {
    const s = baseState({
      status: 'WAITING_RESPONSE',
      pendingResponses: [
        { playerIndex: 1, availableActions: [], priority: 2, deadlineAt: 5000 },
        { playerIndex: 2, availableActions: [], priority: 2, deadlineAt: 5000 }
      ]
    });
    expect(autoResolveAction(s, 2)).toEqual({ playerIndex: 2, action: { type: 'PASS', actionId: 100 } });
  });

  it('autoResolveAction auto-takes kong for the kong picker', () => {
    const s = baseState({
      pendingKongSelection: { playerIndex: 3, kind: 'KONG_ADDED', deadlineAt: 5000 },
      publicKongSlots: [{ visible: 8 }]
    });
    expect(autoResolveAction(s, 3)).toEqual({
      playerIndex: 3,
      action: { type: 'SELECT_KONG_TILE', tile: 8, actionId: 109 }
    });
  });

  it('autoResolveAction discards the first hand tile when it is the player turn', () => {
    const s = baseState({
      currentPlayer: 1,
      players: [
        { seatIndex: 0, isAI: false, hand: [], melds: [], discards: [], status: 'ACTIVE' },
        { seatIndex: 1, isAI: false, hand: [7, 3, 9], melds: [], discards: [], status: 'ACTIVE' },
        { seatIndex: 2, isAI: false, hand: [], melds: [], discards: [], status: 'ACTIVE' },
        { seatIndex: 3, isAI: false, hand: [], melds: [], discards: [], status: 'ACTIVE' }
      ]
    });
    expect(autoResolveAction(s, 1)).toEqual({ playerIndex: 1, action: { type: 'DISCARD', tile: 7, actionId: 7 } });
  });
});
