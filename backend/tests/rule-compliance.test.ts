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
    expect(afterKong.pendingKongSelection).toMatchObject({ playerIndex: 0, kind: 'KONG_ADDED' });
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
    s.lastDraw = { playerIndex: 1, tile: 33, source: 'WALL', stepIndex: 0 };
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

describe('暗杠（先碰后跳过、跨轮暗杠、杠上花）', () => {
  it('allows passing a kong response, keeps tiles in hand, and offers concealed kong on a later turn', () => {
    const eng = engine();
    const s = state();
    s.players[0].hand = [5, 27, 27, 27, 27, 28, 28, 28, 28, 29, 29, 29, 29, 30];
    s.players[1].hand = [5, 5, 18, 18, 0, 1, 2, 6, 7, 8, 10, 11, 12];
    s.players[2].hand = [20, 21, 22, 23, 24, 25, 26, 28, 29, 30, 31, 32, 33];
    s.players[3].hand = [1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14];
    s.currentPlayer = 0;
    s.status = 'PLAYING';

    const afterDiscard = eng.applyAction(s, 0, { type: 'DISCARD', tile: 5, actionId: 5 }).nextState;
    const responseActions = eng.getLegalActions(afterDiscard, 1);
    expect(responseActions.some((action) => action.type === 'PONG')).toBe(true);
    expect(responseActions.some((action) => action.type === 'KONG_EXPOSED')).toBe(true);
    expect(responseActions.some((action) => action.type === 'PASS')).toBe(true);

    const afterPass = eng.applyAction(afterDiscard, 1, { type: 'PASS', actionId: 100 }).nextState;
    // Passing keeps every tile in hand; the next player simply draws on their own turn.
    for (const tile of [5, 5, 18, 18, 0, 1, 2, 6, 7, 8, 10, 11, 12]) {
      expect(afterPass.players[1].hand).toContain(tile);
    }
    expect(afterPass.players[1].hand).toHaveLength(14);
    expect(afterPass.players[1].melds).toHaveLength(0);

    // Simulate many later rounds: on the player's own turn the concealed kong is still available.
    const ownTurn = state({ ...afterPass, currentPlayer: 1, status: 'PLAYING', lastDiscard: undefined, pendingResponses: [] });
    ownTurn.players[1].hand = [5, 5, 18, 18, 0, 1, 2, 6, 7, 8, 10, 11, 12, 12];
    expect(eng.getLegalActions(ownTurn, 1).some((action) => action.type === 'KONG_CONCEALED' && action.tile === 5)).toBe(true);
  });

  it('concealed kong with two real tiles and two chicks takes a public kong tile and wins with 杠上花', () => {
    const eng = engine();
    const s = state();
    s.players[0].hand = [27, 27, 27, 27, 28, 28, 28, 28, 29, 29, 29, 29, 30, 30];
    s.players[1].hand = [5, 5, 18, 18, 0, 1, 2, 6, 7, 8, 10, 11, 12, 12];
    s.players[2].hand = [20, 21, 22, 23, 24, 25, 26, 28, 29, 30, 31, 32, 33];
    s.players[3].hand = [1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14];
    s.currentPlayer = 1;
    s.status = 'PLAYING';
    s.publicKongSlots = [
      { visible: 9, hidden: 8 },
      { visible: 7, hidden: 6 }
    ];

    const afterKong = eng.applyAction(s, 1, { type: 'KONG_CONCEALED', tile: 5, actionId: 107 }).nextState;
    const kongMeld = afterKong.players[1].melds.find((meld) => meld.type === 'KONG_CONCEALED');
    expect(kongMeld?.tiles).toEqual([5, 5, 18, 18]);
    expect(kongMeld?.containsXiaoJiAsWild).toBe(true);
    expect(afterKong.pendingKongSelection).toMatchObject({ playerIndex: 1, kind: 'KONG_CONCEALED' });
    expect(eng.getLegalActions(afterKong, 1).map((action) => action.tile).sort()).toEqual([7, 9]);

    const afterTake = eng.applyAction(afterKong, 1, { type: 'SELECT_KONG_TILE', tile: 9, actionId: 109 }).nextState;
    expect(afterTake.players[1].hand).toContain(9);
    expect(afterTake.lastDraw).toMatchObject({ playerIndex: 1, tile: 9, source: 'PUBLIC_KONG' });
    expect(afterTake.pendingKongSelection).toBeUndefined();

    const winActions = eng.getLegalActions(afterTake, 1).filter((action) => action.type === 'WIN');
    expect(winActions).toHaveLength(1);
    const result = eng.applyAction(afterTake, 1, { type: 'WIN', actionId: 101 });
    expect(result.nextState.status).toBe('FINISHED');
    expect(result.scoreResult?.fanItems?.some((item) => item.code === 'KONG_FLOWER')).toBe(true);
  });

  it('concealed kong with three real tiles and one chick stores three identical tiles plus the chick', () => {
    const eng = engine();
    const s = state();
    s.players[1].hand = [5, 5, 5, 18, 0, 1, 2, 6, 7, 8, 10, 11, 12, 13];
    s.players[0].hand = [27, 27, 27, 27, 28, 28, 28, 28, 29, 29, 29, 29, 30, 30];
    s.players[2].hand = [20, 21, 22, 23, 24, 25, 26, 28, 29, 30, 31, 32, 33];
    s.players[3].hand = [1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14];
    s.currentPlayer = 1;
    s.status = 'PLAYING';
    s.publicKongSlots = [{ visible: 9, hidden: 8 }];

    const afterKong = eng.applyAction(s, 1, { type: 'KONG_CONCEALED', tile: 5, actionId: 107 }).nextState;
    const kongMeld = afterKong.players[1].melds.find((meld) => meld.type === 'KONG_CONCEALED');
    expect(kongMeld?.tiles).toEqual([5, 5, 5, 18]);
    expect(kongMeld?.containsXiaoJiAsWild).toBe(true);
  });

  it('pong + chick added kong, draw 6-dots from the public slot, win counts as kong flower', () => {
    const eng = engine();
    const s = state();
    // Player 0 holds a pong of 9-man on the left plus two chicks; the hand is
    // already a 14-tile win (both chicks as wilds), and a kong is also legal.
    s.players[0].melds = [
      { type: 'PONG', tiles: [8, 8, 8], stepIndex: 0, claimedIndex: 1, fromPlayer: 1 },
      { type: 'CHOW', tiles: [9, 10, 11], stepIndex: 1, claimedIndex: 1, fromPlayer: 3 }
    ];
    s.players[0].hand = [16, 17, 17, 18, 18, 24, 25, 26];
    s.players[1].hand = [20, 21, 22, 23, 24, 25, 26, 28, 29, 30, 31, 32, 33];
    s.players[2].hand = [0, 1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13];
    s.players[3].hand = [1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14];
    s.currentPlayer = 0;
    s.status = 'PLAYING';
    s.publicKongSlots = [
      { visible: 14, hidden: 27 },
      { visible: 5, hidden: 28 }
    ];
    s.wall = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];

    // Both the direct win and the added kong must be offered so the player can
    // choose the kong path instead of being forced into a flat self-draw win.
    const legal = eng.getLegalActions(s, 0);
    expect(legal.some((action) => action.type === 'WIN')).toBe(true);
    expect(legal.some((action) => action.type === 'KONG_ADDED' && action.tile === 8)).toBe(true);

    const afterKong = eng.applyAction(s, 0, { type: 'KONG_ADDED', tile: 8, actionId: 108 }).nextState;
    const kongMeld = afterKong.players[0].melds.find((meld) => meld.type === 'KONG_ADDED');
    expect(kongMeld?.tiles).toEqual([8, 8, 8, 18]);
    expect(kongMeld?.containsXiaoJiAsWild).toBe(true);
    expect(afterKong.pendingKongSelection).toMatchObject({ playerIndex: 0, kind: 'KONG_ADDED' });

    const afterTake = eng.applyAction(afterKong, 0, { type: 'SELECT_KONG_TILE', tile: 14, actionId: 109 }).nextState;
    expect(afterTake.players[0].hand).toContain(14);
    expect(afterTake.lastDraw).toMatchObject({ playerIndex: 0, tile: 14, source: 'PUBLIC_KONG' });

    const winActions = eng.getLegalActions(afterTake, 0).filter((action) => action.type === 'WIN');
    expect(winActions).toHaveLength(1);
    const result = eng.applyAction(afterTake, 0, { type: 'WIN', actionId: 101 });
    expect(result.nextState.status).toBe('FINISHED');
    expect(result.scoreResult?.fanItems?.some((item) => item.code === 'KONG_FLOWER')).toBe(true);
    expect(result.scoreResult?.fanItems?.some((item) => item.code === 'DOUBLE_KONG')).toBe(false);
  });

  it('the same 14-tile win without konging only scores the base fan', () => {
    const eng = engine();
    const s = state();
    s.players[0].melds = [
      { type: 'PONG', tiles: [8, 8, 8], stepIndex: 0, claimedIndex: 1, fromPlayer: 1 },
      { type: 'CHOW', tiles: [9, 10, 11], stepIndex: 1, claimedIndex: 1, fromPlayer: 3 }
    ];
    s.players[0].hand = [16, 17, 17, 18, 18, 24, 25, 26];
    s.players[1].hand = [20, 21, 22, 23, 24, 25, 26, 28, 29, 30, 31, 32, 33];
    s.players[2].hand = [0, 1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13];
    s.players[3].hand = [1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14];
    s.currentPlayer = 0;
    s.status = 'PLAYING';

    const result = eng.applyAction(s, 0, { type: 'WIN', actionId: 101 });
    expect(result.nextState.status).toBe('FINISHED');
    expect(result.scoreResult?.fanItems?.some((item) => item.code === 'KONG_FLOWER')).toBe(false);
    expect(result.scoreResult?.fanItems?.some((item) => item.code === 'BASIC_WIN')).toBe(true);
  });

  it('kong flower with a chick as the exposed kong tile does not score 无鸡', () => {
    const eng = engine();
    const s = state();
    // Mirrors the production round: exposed 6-dot kong uses the chick as its
    // fourth tile, the replacement 2-bamboo completes the pair, win is 杠上花.
    s.players[0].melds = [
      { type: 'PONG', tiles: [10, 10, 10], stepIndex: 29, claimedIndex: 1, fromPlayer: 2 },
      { type: 'KONG_EXPOSED', tiles: [14, 14, 14, 18], stepIndex: 47, claimedIndex: 0, fromPlayer: 3, containsXiaoJiAsWild: true }
    ];
    s.players[0].hand = [5, 0, 2, 6, 19, 1, 7, 19];
    s.lastDraw = { playerIndex: 0, tile: 19, source: 'PUBLIC_KONG', stepIndex: 48 };

    const win = eng.verifyWin(s, 0, undefined, 'SELF_DRAW');
    expect(win.ok).toBe(true);
    const codes = win.fanItems.map((item) => item.code);
    expect(codes).toContain('KONG_FLOWER');
    expect(codes).not.toContain('NO_XIAO_JI');

    // Control: the same winning shape with a real 6-dot kong (no chick) keeps
    // the 无鸡 fan, because no chick appears anywhere in the hand or melds.
    const control = state();
    control.players[0].melds = [
      { type: 'PONG', tiles: [10, 10, 10], stepIndex: 29, claimedIndex: 1, fromPlayer: 2 },
      { type: 'KONG_EXPOSED', tiles: [14, 14, 14, 14], stepIndex: 47, claimedIndex: 0, fromPlayer: 3 }
    ];
    control.players[0].hand = [5, 0, 2, 6, 19, 1, 7, 19];
    control.lastDraw = { playerIndex: 0, tile: 19, source: 'PUBLIC_KONG', stepIndex: 48 };
    const controlWin = eng.verifyWin(control, 0, undefined, 'SELF_DRAW');
    const controlCodes = controlWin.fanItems.map((item) => item.code);
    expect(controlCodes).toContain('KONG_FLOWER');
    expect(controlCodes).toContain('NO_XIAO_JI');
  });

  it('prefers the no-wild decomposition so a real 1-2-3-bamboo chow scores 无鸡', () => {
    const eng = engine();
    const s = state();
    // Mirrors a production round: the chick is a real 1-bamboo in the chow
    // 1-2-3-bamboo (with 6-7-8-man, 1-2-3-dots, pong of 8-dots, pair of red
    // dragon). A wild-using decomposition also exists, but 无鸡 must win.
    s.players[0].melds = [
      { type: 'PONG', tiles: [16, 16, 16], stepIndex: 17, claimedIndex: 1, fromPlayer: 1 }
    ];
    s.players[0].hand = [5, 10, 20, 31, 11, 19, 9, 31, 7, 6, 18];

    const win = eng.verifyWin(s, 0, undefined, 'SELF_DRAW');
    expect(win.ok).toBe(true);
    const codes = win.fanItems.map((item) => item.code);
    expect(codes).toContain('NO_XIAO_JI');
    expect(codes).toContain('BASIC_WIN');
  });

  it('wins with double kong flower after two consecutive kongs on the same turn', () => {
    const eng = engine();
    const s = state();
    // Pong of 9-man plus two public kong draws: the first kong upgrades the pong
    // with the chick, the second is a concealed 5-dot kong; both replacement
    // draws (8-dot) complete the hand with 7/8/9-tiao and a pair of 8-dot.
    s.players[0].melds = [
      { type: 'PONG', tiles: [8, 8, 8], stepIndex: 0, claimedIndex: 1, fromPlayer: 1 },
      { type: 'CHOW', tiles: [9, 10, 11], stepIndex: 1, claimedIndex: 1, fromPlayer: 3 }
    ];
    s.players[0].hand = [13, 13, 13, 13, 18, 24, 25, 26];
    s.players[1].hand = [20, 21, 22, 23, 24, 25, 26, 28, 29, 30, 31, 32, 33];
    s.players[2].hand = [0, 1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13];
    s.players[3].hand = [1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14];
    s.currentPlayer = 0;
    s.status = 'PLAYING';
    s.publicKongSlots = [
      { visible: 16, hidden: 27 },
      { visible: 16, hidden: 28 }
    ];
    s.wall = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

    const legal = eng.getLegalActions(s, 0);
    expect(legal.some((action) => action.type === 'KONG_ADDED' && action.tile === 8)).toBe(true);
    expect(legal.some((action) => action.type === 'KONG_CONCEALED' && action.tile === 13)).toBe(true);

    const afterFirstKong = eng.applyAction(s, 0, { type: 'KONG_ADDED', tile: 8, actionId: 108 }).nextState;
    expect(afterFirstKong.kongDrawStreak?.[0]).toBe(0);
    const afterFirstTake = eng.applyAction(afterFirstKong, 0, { type: 'SELECT_KONG_TILE', tile: 16, actionId: 109 }).nextState;
    expect(afterFirstTake.kongDrawStreak?.[0]).toBe(1);

    const afterSecondKong = eng.applyAction(afterFirstTake, 0, { type: 'KONG_CONCEALED', tile: 13, actionId: 107 }).nextState;
    const afterSecondTake = eng.applyAction(afterSecondKong, 0, { type: 'SELECT_KONG_TILE', tile: 16, actionId: 109 }).nextState;
    expect(afterSecondTake.kongDrawStreak?.[0]).toBe(2);
    expect(afterSecondTake.lastDraw).toMatchObject({ playerIndex: 0, tile: 16, source: 'PUBLIC_KONG' });

    const winActions = eng.getLegalActions(afterSecondTake, 0).filter((action) => action.type === 'WIN');
    expect(winActions).toHaveLength(1);
    const result = eng.applyAction(afterSecondTake, 0, { type: 'WIN', actionId: 101 });
    expect(result.nextState.status).toBe('FINISHED');
    const fanCodes = result.scoreResult?.fanItems?.map((item) => item.code) ?? [];
    expect(fanCodes).toContain('DOUBLE_KONG_FLOWER');
    expect(fanCodes).not.toContain('KONG_FLOWER');
    expect(fanCodes).toContain('DOUBLE_KONG');
  });
});

describe('碰后加杠与胡牌可跳过', () => {
  it('pong first, then allows added kong with the real fourth tile on a later turn', () => {
    const eng = engine();
    const s = state();
    s.players[0].hand = [5, 27, 27, 27, 27, 28, 28, 28, 28, 29, 29, 29, 29, 30];
    s.players[1].hand = [5, 5, 0, 1, 2, 3, 4, 6, 7, 8, 9, 10, 11];
    s.players[2].hand = [20, 21, 22, 23, 24, 25, 26, 28, 29, 30, 31, 32, 33];
    s.players[3].hand = [1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14];
    s.currentPlayer = 0;
    s.status = 'PLAYING';

    const afterDiscard = eng.applyAction(s, 0, { type: 'DISCARD', tile: 5, actionId: 5 }).nextState;
    expect(eng.getLegalActions(afterDiscard, 1).some((action) => action.type === 'PONG')).toBe(true);
    const afterPong = eng.applyAction(afterDiscard, 1, { type: 'PONG', tile: 5, actionId: 102 }).nextState;
    expect(afterPong.players[1].melds.some((meld) => meld.type === 'PONG' && meld.tiles[0] === 5)).toBe(true);

    // Later own turn with the fourth 5 in hand: added kong is available.
    const later = state({ ...afterPong, currentPlayer: 1, status: 'PLAYING', lastDiscard: undefined, pendingResponses: [] });
    later.players[1].hand = [5, 0, 1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12];
    later.publicKongSlots = [{ visible: 9, hidden: 8 }];
    expect(eng.getLegalActions(later, 1).some((action) => action.type === 'KONG_ADDED' && action.tile === 5)).toBe(true);
    const afterKong = eng.applyAction(later, 1, { type: 'KONG_ADDED', tile: 5, actionId: 108 }).nextState;
    expect(afterKong.players[1].melds.some((meld) => meld.type === 'KONG_ADDED' && meld.tiles[0] === 5)).toBe(true);
  });

  it('passing a discard win keeps the game going for the next player', () => {
    const eng = engine();
    const s = state();
    s.players[0].hand = [27, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    s.players[1].hand = [28, 0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12];
    s.players[2].hand = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9, 9, 27];
    s.players[3].hand = [12, 13, 14, 15, 16, 17, 19, 20, 21, 22, 23, 24, 25];
    s.currentPlayer = 0;
    s.status = 'PLAYING';

    const afterDiscard = eng.applyAction(s, 0, { type: 'DISCARD', tile: 27, actionId: 27 }).nextState;
    const winActions = eng.getLegalActions(afterDiscard, 2);
    expect(winActions.some((action) => action.type === 'WIN')).toBe(true);
    expect(winActions.some((action) => action.type === 'PASS')).toBe(true);

    const afterPass = eng.applyAction(afterDiscard, 2, { type: 'PASS', actionId: 100 }).nextState;
    expect(afterPass.status).toBe('PLAYING');
    expect(afterPass.currentPlayer).toBe(1);
    expect(afterPass.players[1].hand).toHaveLength(14);
  });
});

describe('带鸡清一色', () => {
  it('scores QING_YI_SE when the chick is used as a wild in a one-suit hand', () => {
    const s = state();
    s.status = 'PLAYING';
    s.currentPlayer = 0;
    s.xiaoJiActiveAsWild = true;
    s.lastDraw = { playerIndex: 0, tile: 16, source: 'WALL', stepIndex: 32 };
    // 1T 1T | 2T 2T 2T | 4T 5T 6T | 8T 8T + 小鸡(18, wild as 8T), meld 7T x3
    s.players[0].hand = [9, 9, 10, 10, 10, 12, 13, 14, 16, 16, 18];
    s.players[0].melds = [{ type: 'PONG', tiles: [15, 15, 15], stepIndex: 0, claimedIndex: 1, fromPlayer: 1 }];

    const result = engine().applyAction(s, 0, { type: 'WIN', actionId: 101 }).nextState.result as {
      fanItems: Array<{ code: string; name: string; fan: number }>;
      title: string;
    };

    expect(result.title).toBe('自摸胡牌');
    const codes = result.fanItems.map((item) => item.code);
    expect(codes).toContain('QING_YI_SE');
    expect(result.fanItems.find((item) => item.code === 'QING_YI_SE')?.fan).toBe(2);
  });

  it('does not score QING_YI_SE when the chick is a real bamboo tile in a mixed hand', () => {
    const s = state();
    s.status = 'PLAYING';
    s.currentPlayer = 0;
    s.xiaoJiActiveAsWild = true;
    s.lastDraw = { playerIndex: 0, tile: 18, source: 'WALL', stepIndex: 32 };
    // 筒一色 melds + 一条 triplet（小鸡作为真实条子，非癞子）
    s.players[0].hand = [9, 9, 10, 10, 10, 12, 13, 14, 15, 16, 17, 18, 18, 18];

    const result = engine().applyAction(s, 0, { type: 'WIN', actionId: 101 }).nextState.result as {
      fanItems: Array<{ code: string }>;
    };
    const codes = result.fanItems.map((item) => item.code);
    expect(codes).not.toContain('QING_YI_SE');
    expect(codes).not.toContain('HUN_YI_SE');
  });

  it('scores HUN_YI_SE when the chick is a wild in a one-suit hand with honors', () => {
    const s = state();
    s.status = 'PLAYING';
    s.currentPlayer = 0;
    s.xiaoJiActiveAsWild = true;
    s.lastDraw = { playerIndex: 0, tile: 16, source: 'WALL', stepIndex: 32 };
    // 东东 pair | 2T 2T 2T | 4T 5T 6T | 8T 8T + 小鸡(18, wild as 8T), meld 7T x3
    s.players[0].hand = [27, 27, 10, 10, 10, 12, 13, 14, 16, 16, 18];
    s.players[0].melds = [{ type: 'PONG', tiles: [15, 15, 15], stepIndex: 0, claimedIndex: 1, fromPlayer: 1 }];

    const result = engine().applyAction(s, 0, { type: 'WIN', actionId: 101 }).nextState.result as {
      fanItems: Array<{ code: string; fan: number }>;
    };
    const codes = result.fanItems.map((item) => item.code);
    expect(codes).toContain('HUN_YI_SE');
    expect(result.fanItems.find((item) => item.code === 'HUN_YI_SE')?.fan).toBe(1);
    expect(codes).not.toContain('QING_YI_SE');
  });
});
