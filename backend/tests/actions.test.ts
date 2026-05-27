import { describe, expect, it } from 'vitest';
import { decodeAction, encodeAction, normalizeClientAction } from '../src/rules/actions.js';

describe('action encoding', () => {
  it('encodes discards by tile id', () => {
    expect(encodeAction({ type: 'DISCARD', tile: 12 })).toBe(12);
    expect(decodeAction(12)).toEqual({ type: 'DISCARD', tile: 12, actionId: 12 });
  });

  it('encodes fixed actions for training compatibility', () => {
    expect(encodeAction({ type: 'PASS' })).toBe(100);
    expect(encodeAction({ type: 'WIN' })).toBe(101);
    expect(encodeAction({ type: 'KONG_ADDED' })).toBe(108);
  });

  it('normalizes client action intent', () => {
    expect(normalizeClientAction({ type: 'DISCARD', tile: 7, clientSeq: 1 })).toEqual({
      type: 'DISCARD',
      tile: 7,
      actionId: 7
    });
  });
});
