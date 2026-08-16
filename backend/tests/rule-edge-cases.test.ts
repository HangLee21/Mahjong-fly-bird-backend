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
  s.status = 'PLAYING';
  s.currentPlayer = 0;
  s.xiaoJiActiveAsWild = true;
  return s;
}

function applySelfDrawWin(s: GameState, hand: number[], melds: GameState['players'][number]['melds'] = [], drawTile = 18) {
  s.players[0].hand = hand;
  s.players[0].melds = melds;
  s.lastDraw = { playerIndex: 0, tile: drawTile, source: 'WALL', stepIndex: 1 };
  const actions = engine().getLegalActions(s, 0);
  if (!actions.some((a) => a.type === 'WIN')) return null;
  return engine().applyAction(s, 0, { type: 'WIN', actionId: 101 }).nextState.result as {
    fanItems: Array<{ code: string; name: string; fan: number }>;
    winnerDetails: Array<{ winner: number; tile?: number; source: string; fanItems: Array<{ code: string }> }>;
  };
}

describe('wild decomposition boundaries', () => {
  it('two chicks can fill the first two tiles of a chow (9筒+2鸡 = 789筒)', () => {
    // 123万 567万 345筒 9筒+2鸡(789筒) 11筒对
    const result = applySelfDrawWin(state('two_wilds'), [17, 18, 18, 0, 1, 2, 4, 5, 6, 9, 9, 11, 12, 13]);
    expect(result).not.toBeNull();
  });

  it('chick as first tile of a chow works for every suit', () => {
    // 89万+鸡 = 789万, plus 123筒 567条 11筒对
    const result = applySelfDrawWin(state('chow_first_wan'), [7, 8, 18, 9, 10, 11, 19, 20, 21, 23, 24, 25, 9, 9], [], 9);
    expect(result).not.toBeNull();
  });
});

describe('带鸡杠 and one-suit fans', () => {
  it('scores 清一色 when the chick is a wild in a kong meld', () => {
    // 加杠 777筒+鸡, hand: 11筒对 123筒 456筒 789筒
    const result = applySelfDrawWin(
      state('kong_wild_qingyise'),
      [9, 9, 9, 10, 11, 12, 13, 14, 15, 16, 17],
      [{ type: 'KONG_ADDED', tiles: [15, 15, 15, 18], stepIndex: 0, containsXiaoJiAsWild: true }],
      17,
    );
    expect(result).not.toBeNull();
    expect(result!.fanItems.some((f) => f.code === 'QING_YI_SE')).toBe(true);
  });

  it('scores 混一色 when the chick is a wild in a kong meld and honors are present', () => {
    const result = applySelfDrawWin(
      state('kong_wild_hunyise'),
      [27, 27, 9, 10, 11, 12, 13, 14, 15, 16, 17],
      [{ type: 'KONG_ADDED', tiles: [15, 15, 15, 18], stepIndex: 0, containsXiaoJiAsWild: true }],
      17,
    );
    expect(result).not.toBeNull();
    expect(result!.fanItems.some((f) => f.code === 'HUN_YI_SE')).toBe(true);
    expect(result!.fanItems.some((f) => f.code === 'QING_YI_SE')).toBe(false);
  });
});

describe('大对 (all triplets) with a wild', () => {
  it('scores DA_DUI when the chick completes a triplet', () => {
    // 111万 222万 333万 555万(5,5+鸡) 77万对
    const result = applySelfDrawWin(state('dadui_wild'), [0, 0, 0, 1, 1, 1, 2, 2, 2, 4, 4, 18, 6, 6], [], 18);
    expect(result).not.toBeNull();
    expect(result!.fanItems.some((f) => f.code === 'DA_DUI')).toBe(true);
  });

  it('still awards DA_DUI for a real all-triplet hand', () => {
    const result = applySelfDrawWin(state('dadui_real'), [0, 0, 0, 1, 1, 1, 2, 2, 2, 4, 4, 4, 6, 6], [], 4);
    expect(result).not.toBeNull();
    expect(result!.fanItems.some((f) => f.code === 'DA_DUI')).toBe(true);
  });

  it('scores mixed all-triplets when the discard completes a triplet', () => {
    // Production regression, room 963258 at 18:33: the claimed 1-dot must be
    // included for all-triplets analysis and in winnerDetails.hand.
    const s = state('discard_mixed_da_dui');
    s.status = 'WAITING_RESPONSE';
    s.players[0].hand = [9, 9, 16, 16, 17, 17, 18];
    s.players[0].melds = [
      { type: 'PONG', tiles: [29, 29, 29], stepIndex: 1, claimedIndex: 1, fromPlayer: 1 },
      { type: 'PONG', tiles: [33, 33, 33], stepIndex: 2, claimedIndex: 1, fromPlayer: 2 },
    ];
    s.lastDiscard = { tile: 9, fromPlayer: 3, stepIndex: 3 };
    s.pendingResponses = [
      { playerIndex: 0, availableActions: [{ type: 'WIN', tile: 9, actionId: 101 }], priority: 4 },
    ];

    const next = engine().applyAction(s, 0, { type: 'WIN', actionId: 101 }).nextState;
    const result = next.result as {
      scoreDelta: number[];
      fanItems: Array<{ code: string; fan: number }>;
      winnerDetails: Array<{ fan: number; points: number; hand: number[] }>;
    };
    const codes = result.fanItems.map((item) => item.code);

    expect(codes).toContain('HUN_YI_SE');
    expect(codes).toContain('DA_DUI');
    expect(result.winnerDetails[0]).toMatchObject({ fan: 2, points: 4 });
    expect(result.winnerDetails[0].hand.filter((tile) => tile === 9)).toHaveLength(3);
    expect(result.scoreDelta).toEqual([4, 0, 0, -4]);
  });
});

describe('special shapes with the chick', () => {
  it('recognizes 烂牌 with exactly 5 honors', () => {
    const result = applySelfDrawWin(
      state('lanpai'),
      [0, 3, 6, 9, 12, 15, 18, 21, 24, 27, 28, 29, 30, 31],
      [],
      31,
    );
    expect(result).not.toBeNull();
    expect(result!.fanItems.some((f) => f.code === 'LAN_PAI')).toBe(true);
  });

  it('recognizes 小七对 with a wild', () => {
    // 5单张 + 1鸡 = 补齐一对
    const result = applySelfDrawWin(state('seven_pairs_wild'), [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 6, 18, 18], [], 18);
    expect(result).not.toBeNull();
    expect(result!.fanItems.some((f) => f.code === 'SEVEN_PAIRS')).toBe(true);
  });
});

describe('五梅花 and kong flowers', () => {
  it('scores 五梅花 when the public kong replacement is 5筒', () => {
    const s = state('five_meihua');
    s.players[0].hand = [9, 9, 9, 10, 11, 12, 13, 14, 15, 16, 17];
    s.players[0].melds = [{ type: 'KONG_ADDED', tiles: [15, 15, 15, 18], stepIndex: 0, containsXiaoJiAsWild: true }];
    s.lastDraw = { playerIndex: 0, tile: 13, source: 'PUBLIC_KONG', stepIndex: 1 };
    const result = engine().applyAction(s, 0, { type: 'WIN', actionId: 101 }).nextState.result as {
      fanItems: Array<{ code: string; name: string; fan: number }>;
    };
    expect(result.fanItems.some((f) => f.code === 'FIVE_MEI_HUA')).toBe(true);
  });
});

describe('one-shot multi-win winner details', () => {
  it('lists both winners in winnerDetails', () => {
    const s = state('multi_win');
    s.status = 'WAITING_RESPONSE';
    // 两位玩家都能胡 7筒：1号吃炮胡，2号也胡
    s.players[0].hand = [9, 9, 10, 11, 12, 13, 14, 15, 16, 17];
    s.players[1].hand = [0, 0, 0, 1, 1, 1, 2, 2, 2, 4, 4, 4, 6, 6];
    s.players[2].hand = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    s.players[3].hand = [14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26];
    s.lastDiscard = { tile: 15, fromPlayer: 3, stepIndex: 1 };
    s.pendingResponses = [
      { playerIndex: 0, availableActions: [{ type: 'WIN', tile: 15, actionId: 101 }], priority: 4 },
      { playerIndex: 1, availableActions: [{ type: 'WIN', tile: 15, actionId: 102 }], priority: 4 },
    ];
    const next = engine().applyAction(s, 0, { type: 'WIN', actionId: 101 }).nextState;
    const result = next.result as {
      winnerIndexes: number[];
      winnerDetails: Array<{ winner: number; tile?: number; source: string; hand: number[]; melds: Array<{ type: string; tiles: number[] }> }>;
    };
    expect(result.winnerIndexes.sort()).toEqual([0, 1]);
    expect(result.winnerDetails).toHaveLength(2);
    expect(result.winnerDetails.every((d) => d.tile === 15 && d.source === 'DISCARD')).toBe(true);
    // 点炮胡：进张 15 应包含在手牌里
    expect(result.winnerDetails[0].hand).toContain(15);
    expect(Array.isArray(result.winnerDetails[0].melds)).toBe(true);
  });
});

describe('无鸡 with a real chick in melds', () => {
  it('scores 无鸡 when the chick is a real 1条 in a chow meld', () => {
    // 123条(真鸡) 副露 + 123万 567万 345筒 11筒对
    const result = applySelfDrawWin(
      state('wuji_chow_meld'),
      [0, 1, 2, 4, 5, 6, 9, 9, 11, 12, 13],
      [{ type: 'CHOW', tiles: [18, 19, 20], stepIndex: 0, claimedIndex: 0, fromPlayer: 1 }],
      13,
    );
    expect(result).not.toBeNull();
    expect(result!.fanItems.some((f) => f.code === 'NO_XIAO_JI')).toBe(true);
  });

  it('scores 无鸡 when the chick is a real 1条 triplet meld', () => {
    const result = applySelfDrawWin(
      state('wuji_pong_meld'),
      [0, 1, 2, 4, 5, 6, 9, 9, 11, 12, 13],
      [{ type: 'PONG', tiles: [18, 18, 18], stepIndex: 0, claimedIndex: 1, fromPlayer: 1 }],
      13,
    );
    expect(result).not.toBeNull();
    expect(result!.fanItems.some((f) => f.code === 'NO_XIAO_JI')).toBe(true);
  });

  it('does not score 无鸡 when the chick is a wild in a kong meld', () => {
    const result = applySelfDrawWin(
      state('wuji_kong_wild'),
      [9, 9, 9, 10, 11, 12, 13, 14, 15, 16, 17],
      [{ type: 'KONG_ADDED', tiles: [15, 15, 15, 18], stepIndex: 0, containsXiaoJiAsWild: true }],
      17,
    );
    expect(result).not.toBeNull();
    expect(result!.fanItems.some((f) => f.code === 'NO_XIAO_JI')).toBe(false);
  });
});
