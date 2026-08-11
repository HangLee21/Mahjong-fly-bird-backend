import { describe, expect, it } from 'vitest';
import { QujingFeiXiaoJiRuleEngine } from '../src/rules/qujing-fei-xiaoji.js';
import type { GameState } from '../src/game/game.state.js';

function engine() {
  return new QujingFeiXiaoJiRuleEngine();
}

function state(overrides: Partial<GameState> = {}): GameState {
  const s = engine().createInitialState({
    roomId: 'room_qj',
    gameId: 'game_qj',
    ruleVersion: 'qujing-fei-xiaoji-v1.5',
    seed: 'seed_qj',
    players: [0, 1, 2, 3].map((seatIndex) => ({ seatIndex, isAI: false, userId: `u${seatIndex}` }))
  });
  return { ...s, ...overrides };
}

describe('开牌（骰子定位与牌墙）', () => {
  it('deals 14/13/13/13 with 79 drawable tiles and keeps all 136 tiles accounted', () => {
    const s = state();
    expect(s.players.map((p) => p.hand.length)).toEqual([14, 13, 13, 13]);
    expect(s.dice).toBeDefined();
    expect(s.dice!.first).toBeGreaterThanOrEqual(1);
    expect(s.dice!.first).toBeLessThanOrEqual(6);
    expect(s.dice!.second).toBeGreaterThanOrEqual(1);
    expect(s.dice!.second).toBeLessThanOrEqual(6);
    expect(s.wall).toHaveLength(79);
    expect(s.publicKongSlots).toHaveLength(2);

    const all = [
      ...s.players.flatMap((p) => p.hand),
      ...s.wall,
      ...s.publicKongSlots!.flatMap((slot) => [slot.visible, slot.hidden].filter((t): t is number => t !== undefined))
    ];
    expect(all).toHaveLength(136);
  });

  it('is deterministic for the same seed and dealer', () => {
    const a = state({ seed: 'fixed-seed', dealer: 3 });
    const b = state({ seed: 'fixed-seed', dealer: 3 });
    expect(a.wall).toEqual(b.wall);
    expect(a.players[3].hand).toEqual(b.players[3].hand);
    expect(a.dice).toEqual(b.dice);
  });
});

describe('公开杠牌补翻', () => {
  function kongState(): GameState {
    const s = state();
    s.currentPlayer = 0;
    s.status = 'PLAYING';
    s.players[0].melds = [{ type: 'PONG', tiles: [5, 5, 5], stepIndex: 0, claimedIndex: 1, fromPlayer: 1 }];
    s.players[0].hand = [5, 0, 1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12];
    s.players[1].hand = [20, 21, 22, 23, 24, 25, 26, 28, 29, 30, 31, 32, 33];
    s.players[2].hand = [14, 15, 16, 17, 19, 20, 21, 22, 23, 24, 25, 26, 28];
    s.players[3].hand = [1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14];
    s.wall = [1, 2, 3];
    s.publicKongSlots = [
      { visible: 9, hidden: 8 },
      { visible: 7, hidden: 6 }
    ];
    return s;
  }

  it('reveals the hidden tile below the taken stack first', () => {
    const s = kongState();
    const afterKong = engine().applyAction(s, 0, { type: 'KONG_ADDED', tile: 5, actionId: 108 }).nextState;
    expect(afterKong.status).toBe('PLAYING');
    expect(afterKong.pendingKongSelection).toEqual({ playerIndex: 0, kind: 'KONG_ADDED' });
    expect(engine().getLegalActions(afterKong, 0).map((a) => a.tile).sort()).toEqual([7, 9]);

    const afterTake = engine().applyAction(afterKong, 0, { type: 'SELECT_KONG_TILE', tile: 9, actionId: 109 }).nextState;
    expect(afterTake.players[0].hand).toContain(9);
    expect(afterTake.publicKongSlots).toEqual([
      { visible: 7, hidden: 6 },
      { visible: 8 }
    ]);
    expect(afterTake.wall).toEqual([1, 2, 3]);
  });

  it('reveals the newest wall-end stack top when the taken slot has no hidden tile', () => {
    const s = kongState();
    s.publicKongSlots = [{ visible: 9 }, { visible: 7, hidden: 6 }];
    const afterKong = engine().applyAction(s, 0, { type: 'KONG_ADDED', tile: 5, actionId: 108 }).nextState;
    const afterTake = engine().applyAction(afterKong, 0, { type: 'SELECT_KONG_TILE', tile: 9, actionId: 109 }).nextState;
    expect(afterTake.players[0].hand).toContain(9);
    expect(afterTake.publicKongSlots).toEqual([
      { visible: 7, hidden: 6 },
      { visible: 3, hidden: 2 }
    ]);
    expect(afterTake.wall).toEqual([1]);
  });
});

describe('振听', () => {
  it('same-turn furiten blocks winning the same discarded tile again', () => {
    const eng = engine();
    const s = state();
    s.players[0].hand = [27, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    s.players[1].hand = [27, 0, 1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12];
    s.players[2].hand = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9, 9, 27];
    s.players[3].hand = [27, 27, 12, 13, 14, 15, 16, 17, 19, 20, 21, 22, 23];

    const afterFirst = eng.applyAction(s, 0, { type: 'DISCARD', tile: 27, actionId: 27 }).nextState;
    expect((afterFirst.pendingResponses ?? []).find((p) => p.playerIndex === 2)?.availableActions.some((a) => a.type === 'WIN')).toBe(true);

    const afterPass = eng.applyAction(afterFirst, 2, { type: 'PASS', actionId: 100 }).nextState;
    expect(afterPass.furiten?.[2].passedWinTiles).toEqual([27]);
    const afterP3 = eng.applyAction(afterPass, 3, { type: 'PASS', actionId: 100 }).nextState;

    const afterSecond = eng.applyAction(afterP3, 1, { type: 'DISCARD', tile: 27, actionId: 27 }).nextState;
    expect((afterSecond.pendingResponses ?? []).find((p) => p.playerIndex === 2)).toBeUndefined();
    // Player 3 also refused a pong on 27 in the same turn, so nobody is pending.
    expect(afterSecond.status).toBe('PLAYING');
  });

  it('resets same-turn furiten when the player\'s next turn starts', () => {
    const eng = engine();
    const s = state();
    s.players[0].hand = [27, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    s.players[1].hand = [27, 0, 1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12];
    s.players[2].hand = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9, 9, 27];
    s.players[3].hand = [27, 27, 12, 13, 14, 15, 16, 17, 19, 20, 21, 22, 23];

    const afterFirst = eng.applyAction(s, 0, { type: 'DISCARD', tile: 27, actionId: 27 }).nextState;
    const afterPass = eng.applyAction(afterFirst, 2, { type: 'PASS', actionId: 100 }).nextState;
    const afterP3 = eng.applyAction(afterPass, 3, { type: 'PASS', actionId: 100 }).nextState;
    const afterSecond = eng.applyAction(afterP3, 1, { type: 'DISCARD', tile: 27, actionId: 27 }).nextState;
    // Nobody can respond (both win/pong refusals are active), so the turn
    // reaches player 2 and their same-turn furiten resets.
    expect(afterSecond.furiten?.[2].passedWinTiles).toEqual([]);
  });

  it('xiaoji-refusal furiten blocks all discard wins after discarding xiaoji with a win', () => {
    const eng = engine();
    const s = state();
    s.currentPlayer = 1;
    s.players[1].hand = [0, 1, 18, 3, 4, 5, 6, 7, 8, 9, 9, 9, 27, 27];
    s.players[0].hand = [2, 12, 13, 14, 15, 16, 17, 19, 20, 21, 22, 23, 24];

    const afterDiscard = eng.applyAction(s, 1, { type: 'DISCARD', tile: 18, actionId: 18 }).nextState;
    expect(afterDiscard.furiten?.[1].refusedXiaoJiWin).toBe(true);

    const blocked = state();
    blocked.furiten![1].refusedXiaoJiWin = true;
    blocked.players[1].hand = [0, 1, 3, 4, 5, 6, 7, 8, 9, 9, 9, 27, 27];
    blocked.players[0].hand = [2, 12, 13, 14, 15, 16, 17, 19, 20, 21, 22, 23, 24];
    const afterDiscard2 = eng.applyAction(blocked, 0, { type: 'DISCARD', tile: 2, actionId: 2 }).nextState;
    const pending1 = (afterDiscard2.pendingResponses ?? []).find((p) => p.playerIndex === 1);
    expect(pending1?.availableActions.some((a) => a.type === 'WIN')).toBe(false);
  });

  it('discarding a non-xiaoji tile does not set the xiaoji-refusal furiten', () => {
    const s = state();
    s.currentPlayer = 1;
    s.players[1].hand = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9, 9, 27, 27];
    const afterDiscard = engine().applyAction(s, 1, { type: 'DISCARD', tile: 9, actionId: 9 }).nextState;
    expect(afterDiscard.furiten?.[1].refusedXiaoJiWin).toBe(false);
  });

  it('blocks pong on the same discarded tile after passing once in the turn', () => {
    const eng = engine();
    const s = state();
    s.players[0].hand = [5, 0, 1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12];
    s.players[1].hand = [5, 12, 13, 14, 15, 16, 17, 19, 20, 22, 23, 24, 25];
    s.players[2].hand = [5, 5, 1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12];
    s.players[3].hand = [5, 5, 12, 13, 14, 15, 16, 17, 19, 20, 22, 23, 24];

    const afterFirst = eng.applyAction(s, 0, { type: 'DISCARD', tile: 5, actionId: 5 }).nextState;
    expect((afterFirst.pendingResponses ?? []).find((p) => p.playerIndex === 2)?.availableActions.some((a) => a.type === 'PONG')).toBe(true);
    const afterPass = eng.applyAction(afterFirst, 2, { type: 'PASS', actionId: 100 }).nextState;
    expect(afterPass.furiten?.[2].passedPongTiles).toEqual([5]);
    const afterP3 = eng.applyAction(afterPass, 3, { type: 'PASS', actionId: 100 }).nextState;

    const afterSecond = eng.applyAction(afterP3, 1, { type: 'DISCARD', tile: 5, actionId: 5 }).nextState;
    // Player 2's pong on 5 is blocked (they refused it earlier in the turn),
    // while chow responses from the next player remain available.
    const pending2 = (afterSecond.pendingResponses ?? []).find((p) => p.playerIndex === 2);
    expect(pending2?.availableActions.some((a) => a.type === 'PONG')).toBe(false);
    expect(pending2?.availableActions.some((a) => a.type === 'CHOW_LEFT')).toBe(true);
  });
});

describe('抢杠', () => {
  function robState(): GameState {
    const s = state();
    s.currentPlayer = 1;
    s.players[1].melds = [{ type: 'PONG', tiles: [5, 5, 5], stepIndex: 1, claimedIndex: 1, fromPlayer: 0 }];
    s.players[1].hand = [5, 0, 1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12];
    s.players[2].hand = [0, 1, 2, 3, 4, 6, 7, 8, 9, 9, 9, 27, 27];
    s.players[0].hand = [13, 14, 15, 16, 17, 19, 20, 21, 22, 23, 24, 25, 26];
    s.players[3].hand = [10, 11, 12, 13, 14, 15, 16, 17, 19, 20, 21, 22, 23];
    return s;
  }

  it('lets another player rob the added kong and pays everything from the kong adder', () => {
    const s = robState();
    const afterKong = engine().applyAction(s, 1, { type: 'KONG_ADDED', tile: 5, actionId: 108 }).nextState;
    expect(afterKong.status).toBe('WAITING_RESPONSE');
    expect(afterKong.pendingRobKong).toEqual({ tile: 5, fromPlayer: 1 });
    expect(engine().getLegalActions(afterKong, 2).some((a) => a.type === 'WIN')).toBe(true);
    expect(engine().getLegalActions(afterKong, 1)).toEqual([]);

    const result = engine().applyAction(afterKong, 2, { type: 'WIN', actionId: 101 });
    expect(result.nextState.status).toBe('FINISHED');
    expect(result.scoreResult?.reason).toBe('rob_kong_win');
    expect(result.scoreResult?.winnerIndexes).toEqual([2]);
    expect(result.scoreResult?.loserIndexes).toEqual([1]);
    // 无鸡 1 fan -> 2 points, paid 3x by the kong adder.
    expect(result.scoreResult?.scoreDelta).toEqual([0, -6, 6, 0]);
    expect(result.scoreResult?.fanItems?.some((item) => item.code === 'ROB_KONG')).toBe(true);
  });

  it('allows multiple players to rob the same added kong (一炮多响)', () => {
    const s = robState();
    s.players[3].hand = [0, 1, 2, 3, 4, 6, 7, 8, 9, 9, 9, 27, 27];
    const afterKong = engine().applyAction(s, 1, { type: 'KONG_ADDED', tile: 5, actionId: 108 }).nextState;
    const result = engine().applyAction(afterKong, 2, { type: 'WIN', actionId: 101 });
    expect(result.scoreResult?.winnerIndexes?.sort()).toEqual([2, 3]);
    expect(result.scoreResult?.scoreDelta?.[1]).toBe(-12);
  });

  it('completes the kong and draws a public tile when nobody robs', () => {
    const s = robState();
    s.players[2].hand = [10, 11, 12, 13, 14, 15, 16, 17, 19, 20, 21, 22, 23];
    s.publicKongSlots = [
      { visible: 9, hidden: 8 },
      { visible: 7, hidden: 6 }
    ];
    const afterKong = engine().applyAction(s, 1, { type: 'KONG_ADDED', tile: 5, actionId: 108 }).nextState;
    expect(afterKong.status).toBe('PLAYING');
    expect(afterKong.players[1].melds.at(-1)?.type).toBe('KONG_ADDED');
    expect(afterKong.pendingKongSelection?.playerIndex).toBe(1);
  });
});

describe('包牌', () => {
  it('records bao pai when a discard completes an exposed 大三元', () => {
    const s = state();
    s.players[0].hand = [33, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    s.players[1].melds = [
      { type: 'PONG', tiles: [31, 31, 31], stepIndex: 1, claimedIndex: 1, fromPlayer: 2 },
      { type: 'PONG', tiles: [32, 32, 32], stepIndex: 2, claimedIndex: 1, fromPlayer: 3 }
    ];
    s.players[1].hand = [33, 33, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 27];
    const afterDiscard = engine().applyAction(s, 0, { type: 'DISCARD', tile: 33, actionId: 33 }).nextState;
    expect(afterDiscard.baoPai).toContainEqual({ protectedPlayer: 1, payer: 0, kind: 'BIG_THREE_DRAGONS' });
  });

  it('makes the bao-pai payer cover the whole settlement for the protected player', () => {
    const s = state();
    s.currentPlayer = 1;
    s.players[1].melds = [
      { type: 'PONG', tiles: [31, 31, 31], stepIndex: 1, claimedIndex: 1, fromPlayer: 2 },
      { type: 'PONG', tiles: [32, 32, 32], stepIndex: 2, claimedIndex: 1, fromPlayer: 3 }
    ];
    s.players[1].hand = [33, 33, 33, 0, 1, 2, 27, 27];
    s.baoPai = [{ protectedPlayer: 1, payer: 0, kind: 'BIG_THREE_DRAGONS' }];
    const result = engine().applyAction(s, 1, { type: 'WIN', actionId: 101 });
    expect(result.scoreResult?.winnerIndexes).toEqual([1]);
    // 大三元 2 + 无鸡 1 + 混一色 1 -> capped 3 fan (8 points), paid 3x by the bao payer.
    expect(result.scoreResult?.scoreDelta).toEqual([-24, 24, 0, 0]);
  });
});

describe('四风连打', () => {
  it('pays 1 point from the dealer to each player and re-deals the round', () => {
    const eng = engine();
    const s = state();
    s.players[0].hand = [27, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    s.players[1].hand = [27, 0, 1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12];
    s.players[2].hand = [27, 0, 1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12];
    s.players[3].hand = [27, 0, 1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12];

    let current = s;
    let result: ReturnType<typeof eng.applyAction> | undefined;
    for (const player of [0, 1, 2, 3]) {
      result = eng.applyAction(current, player, { type: 'DISCARD', tile: 27, actionId: 27 });
      current = result.nextState;
    }

    expect(result!.events.some((event) => event.type === 'ROUND_REDEALT')).toBe(true);
    const fresh = current;
    expect(fresh.status).toBe('PLAYING');
    expect(fresh.dealer).toBe(0);
    expect(fresh.currentRound).toBe(1);
    expect(fresh.scores).toEqual([-3, 1, 1, 1]);
    expect(fresh.players.map((p) => p.hand.length)).toEqual([14, 13, 13, 13]);
    expect(fresh.wall).toHaveLength(79);
    expect(fresh.firstRound?.count).toBe(0);
  });
});

describe('十风 / 十三幺 连续出牌和牌', () => {
  it('wins with 十风 after ten consecutive honor discards', () => {
    const s = state();
    s.currentPlayer = 0;
    s.specialRuns![0] = { honorDiscards: 9, yaojiuDiscards: 9, containsXiaoJiDiscard: false, brokenByMeld: false };
    s.players[0].hand = [27, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    const result = engine().applyAction(s, 0, { type: 'DISCARD', tile: 27, actionId: 27 });
    expect(result.nextState.status).toBe('FINISHED');
    expect(result.scoreResult?.winnerIndexes).toEqual([0]);
    expect(result.scoreResult?.fanItems?.some((item) => item.code === 'TEN_HONORS')).toBe(true);
    expect(result.scoreResult?.scoreDelta).toEqual([24, -8, -8, -8]);
  });

  it('wins with 十三幺（无鸡） after thirteen consecutive yaojiu discards', () => {
    const s = state();
    s.currentPlayer = 0;
    s.specialRuns![0] = { honorDiscards: 0, yaojiuDiscards: 12, containsXiaoJiDiscard: false, brokenByMeld: false };
    s.players[0].hand = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 27];
    const result = engine().applyAction(s, 0, { type: 'DISCARD', tile: 27, actionId: 27 });
    expect(result.scoreResult?.fanItems?.some((item) => item.code === 'THIRTEEN_YAO_DISCARDS' && item.points === 8)).toBe(true);
    expect(result.scoreResult?.scoreDelta).toEqual([24, -8, -8, -8]);
  });

  it('breaks the special run when a non-yaojiu tile is discarded', () => {
    const s = state();
    s.currentPlayer = 0;
    s.specialRuns![0] = { honorDiscards: 9, yaojiuDiscards: 9, containsXiaoJiDiscard: false, brokenByMeld: false };
    s.players[0].hand = [5, 0, 1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12];
    s.players[1].hand = [13, 14, 15, 16, 17, 19, 20, 21, 22, 23, 24, 25, 26];
    s.players[2].hand = [10, 11, 12, 13, 14, 15, 16, 17, 19, 20, 21, 22, 23];
    s.players[3].hand = [1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14];
    const result = engine().applyAction(s, 0, { type: 'DISCARD', tile: 5, actionId: 5 });
    expect(result.nextState.status).not.toBe('FINISHED');
    expect(result.nextState.specialRuns?.[0].honorDiscards).toBe(-999);
  });
});

describe('诈和', () => {
  it('verifyWin rejects an invalid hand', () => {
    const s = state();
    s.players[0].hand = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
    expect(engine().verifyWin(s, 0).ok).toBe(false);
  });

  it('settles a fixed 8-point penalty to each other player and ends the round', () => {
    const s = state();
    const result = engine().settleFalseWin(s, 0);
    expect(result.nextState.status).toBe('FINISHED');
    expect(result.scoreResult?.reason).toBe('false_win');
    expect(result.scoreResult?.scoreDelta).toEqual([-24, 8, 8, 8]);
  });
});

describe('相公（手牌数校正）', () => {
  it('多牌: skips the draw and only allows discarding until corrected', () => {
    const s = state();
    s.handErrors = [0, 1, 0, 0];
    s.players[0].hand = [5, 0, 1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12];
    s.players[1].hand = [13, 14, 15, 16, 17, 19, 20, 21, 22, 23, 24, 25, 26, 28];
    s.players[2].hand = [10, 11, 12, 13, 14, 15, 16, 17, 19, 20, 21, 22, 23];
    s.players[3].hand = [1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14];
    const wallBefore = s.wall.length;
    const afterDiscard = engine().applyAction(s, 0, { type: 'DISCARD', tile: 5, actionId: 5 }).nextState;
    expect(afterDiscard.currentPlayer).toBe(1);
    expect(afterDiscard.players[1].hand).toHaveLength(14);
    expect(afterDiscard.wall).toHaveLength(wallBefore);
    const legal = engine().getLegalActions(afterDiscard, 1);
    expect(legal.every((a) => a.type === 'DISCARD' || a.type === 'WIN')).toBe(true);

    const corrected = engine().applyAction(afterDiscard, 1, { type: 'DISCARD', tile: 13, actionId: 13 }).nextState;
    expect(corrected.handErrors?.[1]).toBe(0);
  });

  it('少牌: draws without discarding and passes the turn until corrected', () => {
    const s = state();
    s.handErrors = [0, -1, 0, 0];
    s.players[0].hand = [5, 0, 1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12];
    s.players[1].hand = [13, 14, 15, 16, 17, 19, 20, 21, 22, 23, 24, 25];
    s.players[2].hand = [10, 11, 12, 13, 14, 15, 16, 17, 19, 20, 21, 22, 23];
    s.players[3].hand = [1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14];
    const wallBefore = s.wall.length;
    const afterDiscard = engine().applyAction(s, 0, { type: 'DISCARD', tile: 5, actionId: 5 }).nextState;
    expect(afterDiscard.currentPlayer).toBe(2);
    expect(afterDiscard.players[1].hand).toHaveLength(13);
    expect(afterDiscard.handErrors?.[1]).toBe(0);
    expect(afterDiscard.wall).toHaveLength(wallBefore - 2);
  });
});

describe('番种细节', () => {
  it('小七对龙背 requires two quads and the winning tile inside one of them', () => {
    const eng = engine();
    const inQuad = state();
    inQuad.players[0].hand = [0, 0, 0, 5, 5, 5, 5, 9, 9, 12, 12, 27, 27];
    const longBei = eng.verifyWin(inQuad, 0, 0, 'DISCARD');
    expect(longBei.ok).toBe(true);
    expect(longBei.fanItems.some((item) => item.code === 'SEVEN_PAIRS_LONG_BEI')).toBe(true);

    const notInQuad = state();
    notInQuad.players[0].hand = [0, 0, 0, 0, 5, 5, 5, 5, 9, 9, 12, 12, 27];
    const plain = eng.verifyWin(notInQuad, 0, 27, 'DISCARD');
    expect(plain.ok).toBe(true);
    expect(plain.fanItems.some((item) => item.code === 'SEVEN_PAIRS')).toBe(true);
    expect(plain.fanItems.some((item) => item.code === 'SEVEN_PAIRS_LONG_BEI')).toBe(false);
  });

  it('门清自摸 does not stack with 小七对/烂牌', () => {
    const eng = engine();
    const sevenPairs = state();
    sevenPairs.players[0].hand = [0, 0, 0, 0, 5, 5, 5, 5, 9, 9, 12, 12, 27, 27];
    sevenPairs.lastDraw = { playerIndex: 0, tile: 27, source: 'WALL', stepIndex: 1 };
    const win = eng.verifyWin(sevenPairs, 0, undefined, 'SELF_DRAW');
    expect(win.fanItems.some((item) => item.code === 'MEN_QING_SELF_DRAW')).toBe(false);

    const standard = state();
    standard.players[0].hand = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9, 9, 27, 27];
    standard.lastDraw = { playerIndex: 0, tile: 27, source: 'WALL', stepIndex: 1 };
    const standardWin = eng.verifyWin(standard, 0, undefined, 'SELF_DRAW');
    expect(standardWin.fanItems.some((item) => item.code === 'MEN_QING_SELF_DRAW')).toBe(true);
  });

  it('全求人 with xiaoji as the only wild tile cannot win by discard', () => {
    const eng = engine();
    const wildOnly = state();
    wildOnly.players[1].melds = [
      { type: 'PONG', tiles: [5, 5, 5], stepIndex: 1, claimedIndex: 1, fromPlayer: 0 },
      { type: 'PONG', tiles: [6, 6, 6], stepIndex: 2, claimedIndex: 1, fromPlayer: 2 },
      { type: 'PONG', tiles: [7, 7, 7], stepIndex: 3, claimedIndex: 1, fromPlayer: 3 },
      { type: 'CHOW', tiles: [8, 9, 10], stepIndex: 4, claimedIndex: 1, fromPlayer: 0 }
    ];
    wildOnly.players[1].hand = [18];
    expect(eng.verifyWin(wildOnly, 1, 11, 'DISCARD').ok).toBe(false);

    const realTile = state();
    realTile.players[1].melds = wildOnly.players[1].melds;
    realTile.players[1].hand = [11];
    expect(eng.verifyWin(realTile, 1, 11, 'DISCARD').ok).toBe(true);
  });

  it('四小鸡 is only a self-draw win', () => {
    const eng = engine();
    const s = state();
    s.players[0].hand = [18, 18, 18, 18, 0, 1, 2, 3, 4, 5, 6, 7, 8];
    const selfDraw = eng.verifyWin(s, 0, undefined, 'SELF_DRAW');
    expect(selfDraw.code).toBe('FOUR_XIAO_JI');
    const onDiscard = eng.verifyWin(s, 0, 27, 'DISCARD');
    expect(onDiscard.code).not.toBe('FOUR_XIAO_JI');
  });

  it('杠上开花 and 五梅花 use the public kong draw', () => {
    const eng = engine();
    const fiveMeiHua = state();
    fiveMeiHua.lastDraw = { playerIndex: 0, tile: 13, source: 'PUBLIC_KONG', stepIndex: 1 };
    fiveMeiHua.players[0].hand = [13, 13, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9, 9];
    const win = eng.verifyWin(fiveMeiHua, 0, undefined, 'SELF_DRAW');
    expect(win.fanItems.some((item) => item.code === 'FIVE_MEI_HUA')).toBe(true);

    const kongFlower = state();
    kongFlower.lastDraw = { playerIndex: 0, tile: 5, source: 'PUBLIC_KONG', stepIndex: 1 };
    kongFlower.players[0].hand = [5, 5, 5, 0, 1, 2, 3, 4, 6, 7, 8, 9, 9, 9];
    const win2 = eng.verifyWin(kongFlower, 0, undefined, 'SELF_DRAW');
    expect(win2.fanItems.some((item) => item.code === 'KONG_FLOWER')).toBe(true);
  });
});

describe('流局阈值', () => {
  it('ends as a draw when a kong settlement reaches the wall threshold', () => {
    const s = state();
    s.currentPlayer = 1;
    s.kongCount = 1;
    s.wall = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
    s.publicKongSlots = [{ visible: 20, hidden: 21 }];
    s.players[1].melds = [{ type: 'PONG', tiles: [5, 5, 5], stepIndex: 1, claimedIndex: 1, fromPlayer: 0 }];
    s.players[1].hand = [5, 0, 1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12];
    s.players[2].hand = [13, 14, 15, 16, 17, 19, 20, 21, 22, 23, 24, 25, 26];
    s.players[0].hand = [10, 11, 12, 13, 14, 15, 16, 17, 19, 20, 21, 22, 23];
    s.players[3].hand = [1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14];
    const result = engine().applyAction(s, 1, { type: 'KONG_ADDED', tile: 5, actionId: 108 });
    expect(result.nextState.status).toBe('FINISHED');
    expect(result.scoreResult?.isDraw).toBe(true);
  });
});
