import { describe, expect, it } from 'vitest';
import { QujingFeiXiaoJiRuleEngine } from '../src/rules/qujing-fei-xiaoji.js';
import type { GameState } from '../src/game/game.state.js';

function engine() {
  return new QujingFeiXiaoJiRuleEngine();
}

function state(gameId: string): GameState {
  const s = engine().createInitialState({
    roomId: 'room_qj',
    gameId,
    ruleVersion: 'qujing-fei-xiaoji-v1.5',
    seed: 'seed_qj',
    players: [0, 1, 2, 3].map((seatIndex) => ({ seatIndex, isAI: false, userId: `u${seatIndex}` }))
  });
  s.xiaoJiActiveAsWild = true;
  return s;
}

describe('repro: 123567万 11筒 345筒 89筒 1条', () => {
  it('recognizes the self-draw win with the chick as wild (7筒)', () => {
    const s = state('self_draw');
    s.status = 'PLAYING';
    s.currentPlayer = 0;
    s.players[0].hand = [0, 1, 2, 4, 5, 6, 9, 9, 11, 12, 13, 16, 17, 18];
    s.lastDraw = { playerIndex: 0, tile: 18, source: 'WALL', stepIndex: 1 };

    const actions = engine().getLegalActions(s, 0);
    expect(actions.some((a) => a.type === 'WIN')).toBe(true);

    const result = engine().applyAction(s, 0, { type: 'WIN', actionId: 101 }).nextState.result as {
      fanItems: Array<{ code: string; name: string; fan: number }>;
      winnerDetails: Array<{ winner: number; tile?: number; source: string }>;
    };
    console.log('self-draw fanItems:', result.fanItems.map((f) => `${f.name}(${f.fan})`).join(', '));
    expect(result.winnerDetails[0]).toMatchObject({ winner: 0, tile: 18, source: 'SELF_DRAW' });
  });

  it('accumulates totalScores across rounds instead of overwriting with round scores', () => {
    const s = state('totals');
    s.status = 'PLAYING';
    s.currentPlayer = 0;
    s.scores = [0, 0, 0, 0];
    s.totalScores = [100, 50, 0, -150];
    s.players[0].hand = [0, 1, 2, 4, 5, 6, 9, 9, 11, 12, 13, 16, 17, 18];
    s.lastDraw = { playerIndex: 0, tile: 18, source: 'WALL', stepIndex: 1 };

    const next = engine().applyAction(s, 0, { type: 'WIN', actionId: 101 }).nextState;
    const result = next.result as { scoreDelta: number[] };
    expect(next.totalScores).toEqual([100, 50, 0, -150].map((total, index) => total + result.scoreDelta[index]));
    expect(next.totalScores).not.toEqual(next.scores);
  });
});
