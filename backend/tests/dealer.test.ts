import { describe, expect, it } from 'vitest';
import { resolveNextDealer } from '../src/game/game.service.js';

describe('dealer rotation', () => {
  it('uses the winner as next dealer after a single win', () => {
    expect(resolveNextDealer({ winnerIndexes: [2], loserIndexes: [0], dealer: 1 }, 0)).toBe(2);
  });

  it('uses the discarder as next dealer after multiple discard wins', () => {
    expect(resolveNextDealer({ winnerIndexes: [1, 2], loserIndexes: [3], dealer: 0 }, 0)).toBe(3);
  });

  it('keeps the previous dealer after a draw', () => {
    expect(resolveNextDealer({ winnerIndexes: [], loserIndexes: [], dealer: 1, isDraw: true }, 0)).toBe(1);
  });
});
