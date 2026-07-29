import { describe, expect, it } from 'vitest';
import { QujingFeiXiaoJiRuleEngine } from '../src/rules/qujing-fei-xiaoji.js';

function state() {
  const engine = new QujingFeiXiaoJiRuleEngine();
  return engine.createInitialState({
    roomId: 'room_qj',
    gameId: 'game_qj',
    ruleVersion: 'qujing-fei-xiaoji-v1.5',
    seed: 'seed_qj',
    players: [0, 1, 2, 3].map((seatIndex) => ({ seatIndex, isAI: false, userId: `u${seatIndex}` }))
  });
}

describe('QujingFeiXiaoJiRuleEngine', () => {
  it('starts with the provided dealer and gives that seat the extra tile', () => {
    const engine = new QujingFeiXiaoJiRuleEngine();
    const s = engine.createInitialState({
      roomId: 'room_qj',
      gameId: 'game_qj',
      ruleVersion: 'qujing-fei-xiaoji-v1.5',
      seed: 'seed_qj',
      dealer: 2,
      players: [0, 1, 2, 3].map((seatIndex) => ({ seatIndex, isAI: false, userId: `u${seatIndex}` }))
    });

    expect(s.dealer).toBe(2);
    expect(s.currentPlayer).toBe(2);
    expect(s.players.map((player) => player.hand.length)).toEqual([13, 13, 14, 13]);
  });

  it('allows a standard self draw win', () => {
    const engine = new QujingFeiXiaoJiRuleEngine();
    const s = state();
    s.players[0].hand = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9, 9, 27, 27];
    expect(engine.getLegalActions(s, 0).some((action) => action.type === 'WIN')).toBe(true);
    const result = engine.applyAction(s, 0, { type: 'WIN', actionId: 101 });
    expect(result.nextState.status).toBe('FINISHED');
    expect(result.scoreResult?.winnerIndexes).toEqual([0]);
  });

  it('opens a pong response after another player discards', () => {
    const engine = new QujingFeiXiaoJiRuleEngine();
    const s = state();
    s.players[0].hand = [5, 0, 1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13];
    s.players[1].hand = [5, 5, 1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12];
    const afterDiscard = engine.applyAction(s, 0, { type: 'DISCARD', tile: 5, actionId: 5 }).nextState;
    expect(afterDiscard.status).toBe('WAITING_RESPONSE');
    expect(engine.getLegalActions(afterDiscard, 1).some((action) => action.type === 'PONG')).toBe(true);
  });

  it('offers both pong and exposed kong when the same discard supports both', () => {
    const engine = new QujingFeiXiaoJiRuleEngine();
    const s = state();
    s.players[0].hand = [5, 0, 1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13];
    s.players[1].hand = [5, 5, 5, 1, 2, 3, 4, 6, 7, 8, 9, 10, 11];

    const afterDiscard = engine.applyAction(s, 0, { type: 'DISCARD', tile: 5, actionId: 5 }).nextState;
    const legal = engine.getLegalActions(afterDiscard, 1);

    expect(legal.some((action) => action.type === 'PONG')).toBe(true);
    expect(legal.some((action) => action.type === 'KONG_EXPOSED')).toBe(true);

    const afterPong = engine.applyAction(afterDiscard, 1, { type: 'PONG', tile: 5, actionId: 102 }).nextState;
    expect(afterPong.players[1].melds.at(-1)?.type).toBe('PONG');
  });

  it('allows next player to chow without using xiaoji as wildcard', () => {
    const engine = new QujingFeiXiaoJiRuleEngine();
    const s = state();
    s.players[0].hand = [3, 0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
    s.players[1].hand = [4, 5, 1, 2, 6, 7, 8, 9, 10, 11, 12, 13, 14];
    const afterDiscard = engine.applyAction(s, 0, { type: 'DISCARD', tile: 3, actionId: 3 }).nextState;
    expect(engine.getLegalActions(afterDiscard, 1).some((action) => action.type === 'CHOW_LEFT')).toBe(true);
  });

  it('uses xiaoji as a wildcard for winning', () => {
    const engine = new QujingFeiXiaoJiRuleEngine();
    const s = state();
    s.players[0].hand = [0, 1, 18, 3, 4, 5, 6, 7, 8, 9, 9, 9, 27, 27];
    expect(engine.getLegalActions(s, 0).some((action) => action.type === 'WIN')).toBe(true);
  });

  it('does not allow discard win with only bottom hand', () => {
    const engine = new QujingFeiXiaoJiRuleEngine();
    const s = state();
    s.players[0].hand = [9, 0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13];
    s.players[1].hand = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9, 18, 27];
    const afterDiscard = engine.applyAction(s, 0, { type: 'DISCARD', tile: 9, actionId: 9 }).nextState;
    expect(engine.getLegalActions(afterDiscard, 1).some((action) => action.type === 'WIN')).toBe(false);
  });

  it('allows discard win when no-xiaoji supplies a starting fan', () => {
    const engine = new QujingFeiXiaoJiRuleEngine();
    const s = state();
    s.players[0].hand = [27, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    s.players[1].hand = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9, 9, 27];
    s.xiaoJiActiveAsWild = false;
    const afterDiscard = engine.applyAction(s, 0, { type: 'DISCARD', tile: 27, actionId: 27 }).nextState;
    expect(engine.getLegalActions(afterDiscard, 1).some((action) => action.type === 'WIN')).toBe(true);
  });
});
