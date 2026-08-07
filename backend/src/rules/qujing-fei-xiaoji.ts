import { DEFAULT_PLAYER_COUNT, INITIAL_HAND_SIZE, TILE_TYPE_COUNT } from '../config/constants.js';
import { nowMs } from '../common/time.js';
import { AppError } from '../common/errors.js';
import { buildPlayerGameView } from '../game/game.serializer.js';
import type { GameState, Meld, PlayerState, PendingResponse } from '../game/game.state.js';
import type { CreateGameInput } from '../game/game.types.js';
import { hashJson } from '../game/game.snapshot.js';
import type { GameAction } from './actions.js';
import { encodeAction, sameAction } from './actions.js';
import { shuffleWall, countTiles } from './tile.js';
import type { GameEvent, RuleEngine, RuleResult, ScoreResult } from './rule.types.js';

const XIAO_JI = 18; // 1-tiao in the 0-33 tile mapping.
const HONOR_START = 27;
const DRAW_WALL_THRESHOLD = 20;

type WinContext = 'SELF_DRAW' | 'DISCARD';
type WinSource = 'SELF_DRAW' | 'DISCARD' | 'ROB_KONG';

type FanItem = { code: string; name: string; fan: number; points: number; description?: string };

type WinAnalysis = {
  ok: boolean;
  code: string;
  title: string;
  fan: number;
  points: number;
  fanItems: FanItem[];
  usesXiaoJiAsWild: boolean;
  basicOnly: boolean;
  selfDrawLike: boolean;
};

function cloneState(state: GameState): GameState {
  return structuredClone(state);
}

function drawWallThreshold(state: GameState) {
  const mod = (state.kongCount ?? 0) % 3;
  if (mod === 1) return 14;
  if (mod === 2) return 16;
  return DRAW_WALL_THRESHOLD;
}

function suit(tile: number) {
  if (tile >= HONOR_START) return 'honor';
  return Math.floor(tile / 9);
}

function rank(tile: number) {
  return (tile % 9) + 1;
}

function isHonor(tile: number) {
  return tile >= HONOR_START;
}

function isYaojiu(tile: number) {
  return isHonor(tile) || rank(tile) === 1 || rank(tile) === 9;
}

function isDragon(tile: number) {
  return tile >= 31 && tile <= 33;
}

function isWind(tile: number) {
  return tile >= 27 && tile <= 30;
}

function isSuited(tile: number) {
  return tile >= 0 && tile < HONOR_START;
}

function sortedUnique(tiles: number[]) {
  return [...new Set(tiles)].sort((a, b) => a - b);
}

function allPlayerTiles(player: PlayerState) {
  return [...player.hand, ...player.melds.flatMap((meld) => meld.tiles)];
}

function removeTiles(hand: number[], tiles: number[]) {
  const next = [...hand];
  for (const tile of tiles) {
    const index = next.indexOf(tile);
    if (index < 0) return null;
    next.splice(index, 1);
  }
  return next;
}

function canUseAsSequence(tile: number, a: number, b: number) {
  return isSuited(tile) && suit(tile) === suit(a) && suit(tile) === suit(b) && [tile, a, b].sort((x, y) => x - y).every((item, index, sorted) => index === 0 || item === sorted[index - 1] + 1);
}

function chowTiles(tile: number, actionType: GameAction['type']) {
  if (!isSuited(tile)) return null;
  const candidates =
    actionType === 'CHOW_LEFT'
      ? [tile + 1, tile + 2]
      : actionType === 'CHOW_MIDDLE'
        ? [tile - 1, tile + 1]
        : actionType === 'CHOW_RIGHT'
          ? [tile - 2, tile - 1]
          : null;
  if (!candidates) return null;
  if (!canUseAsSequence(tile, candidates[0], candidates[1])) return null;
  return candidates;
}

function canMakeSets(counts: number[], wildcards: number, setsNeeded: number): boolean {
  if (setsNeeded === 0) return counts.every((count) => count === 0);
  const first = counts.findIndex((count) => count > 0);
  if (first < 0) return wildcards >= setsNeeded * 3;

  const tripletNeed = Math.max(0, 3 - counts[first]);
  if (tripletNeed <= wildcards) {
    const next = [...counts];
    next[first] = Math.max(0, next[first] - 3);
    if (canMakeSets(next, wildcards - tripletNeed, setsNeeded - 1)) return true;
  }

  if (isSuited(first) && rank(first) <= 7) {
    const a = first + 1;
    const b = first + 2;
    if (suit(first) === suit(a) && suit(first) === suit(b)) {
      const next = [...counts];
      next[first] -= 1;
      let need = 0;
      for (const tile of [a, b]) {
        if (next[tile] > 0) next[tile] -= 1;
        else need += 1;
      }
      if (need <= wildcards && canMakeSets(next, wildcards - need, setsNeeded - 1)) return true;
    }
  }

  return false;
}

function minWildcardsForSets(counts: number[], setsNeeded: number): number | null {
  for (let wildcards = 0; wildcards <= 4; wildcards += 1) {
    if (canMakeSets([...counts], wildcards, setsNeeded)) return wildcards;
  }
  return null;
}

function isStandardWin(tiles: number[], openMeldCount: number) {
  const counts = countTiles(tiles);
  const wildcards = counts[XIAO_JI];
  counts[XIAO_JI] = 0;
  const setsNeeded = 4 - openMeldCount;

  for (let pairTile = 0; pairTile < TILE_TYPE_COUNT; pairTile += 1) {
    const pairNeed = Math.max(0, 2 - counts[pairTile]);
    if (pairNeed > wildcards) continue;
    const next = [...counts];
    next[pairTile] = Math.max(0, next[pairTile] - 2);
    if (canMakeSets(next, wildcards - pairNeed, setsNeeded)) return true;
  }

  return wildcards >= 2 && canMakeSets([...counts], wildcards - 2, setsNeeded);
}

function standardWinWildUsage(tiles: number[], openMeldCount: number, allowWild = true) {
  const counts = countTiles(tiles);
  const wildcards = allowWild ? counts[XIAO_JI] : 0;
  if (allowWild) counts[XIAO_JI] = 0;
  const setsNeeded = 4 - openMeldCount;
  let best: number | null = null;

  for (let pairTile = 0; pairTile < TILE_TYPE_COUNT; pairTile += 1) {
    const pairNeed = Math.max(0, 2 - counts[pairTile]);
    if (pairNeed > wildcards) continue;
    const next = [...counts];
    next[pairTile] = Math.max(0, next[pairTile] - 2);
    const setNeed = minWildcardsForSets(next, setsNeeded);
    if (setNeed !== null && pairNeed + setNeed <= wildcards) {
      best = best === null ? pairNeed + setNeed : Math.min(best, pairNeed + setNeed);
    }
  }

  if (allowWild && wildcards >= 2) {
    const setNeed = minWildcardsForSets([...counts], setsNeeded);
    if (setNeed !== null && setNeed + 2 <= wildcards) best = best === null ? setNeed + 2 : Math.min(best, setNeed + 2);
  }

  return { ok: best !== null, wildcardsUsed: best ?? 0 };
}

function isSevenPairs(tiles: number[]) {
  if (tiles.length !== 14) return false;
  const counts = countTiles(tiles);
  const wildcards = counts[XIAO_JI];
  counts[XIAO_JI] = 0;
  let need = 0;
  let pairs = 0;
  for (const count of counts) {
    pairs += Math.floor(count / 2);
    if (count % 2 === 1) need += 1;
  }
  if (need > wildcards) return false;
  pairs += need;
  pairs += Math.floor((wildcards - need) / 2);
  return pairs >= 7;
}

function sevenPairsWildUsage(tiles: number[], allowWild = true) {
  if (tiles.length !== 14) return { ok: false, wildcardsUsed: 0, hasQuadPair: false };
  const counts = countTiles(tiles);
  const wildcards = allowWild ? counts[XIAO_JI] : 0;
  if (allowWild) counts[XIAO_JI] = 0;
  let need = 0;
  let pairs = 0;
  let hasQuadPair = false;
  for (const count of counts) {
    pairs += Math.floor(count / 2);
    if (count >= 4) hasQuadPair = true;
    if (count % 2 === 1) need += 1;
  }
  if (need > wildcards) return { ok: false, wildcardsUsed: 0, hasQuadPair };
  pairs += need;
  pairs += Math.floor((wildcards - need) / 2);
  return { ok: pairs >= 7, wildcardsUsed: need, hasQuadPair };
}

function isLanPai(tiles: number[]) {
  const counts = countTiles(tiles);
  if (counts.some((count) => count > 1)) return false;
  const honors = tiles.filter((tile) => tile >= HONOR_START);
  if (honors.length < 5) return false;
  for (let base = 0; base < HONOR_START; base += 9) {
    const nums = tiles.filter((tile) => tile >= base && tile < base + 9).map(rank);
    for (let i = 0; i < nums.length; i += 1) {
      for (let j = i + 1; j < nums.length; j += 1) {
        if (![3, 6].includes(Math.abs(nums[i] - nums[j]))) return false;
      }
    }
  }
  return true;
}

function isThirteenYao(tiles: number[]) {
  return tiles.every((tile) => tile >= HONOR_START || rank(tile) === 1 || rank(tile) === 9);
}

function hasNoXiaoJiAsWild(player: PlayerState, usesXiaoJiAsWild: boolean) {
  if (usesXiaoJiAsWild) return false;
  return true;
}

function isMenQing(player: PlayerState) {
  return player.melds.every((meld) => meld.type === 'KONG_CONCEALED');
}

function isQingYiSe(tiles: number[]) {
  const suited = tiles.filter(isSuited);
  if (suited.length === 0) return true;
  if (tiles.some((tile) => isHonor(tile))) return false;
  return new Set(suited.map(suit)).size === 1;
}

function isHunYiSe(tiles: number[]) {
  const suited = tiles.filter(isSuited);
  return suited.length > 0 && tiles.some(isHonor) && new Set(suited.map(suit)).size === 1;
}

function meldTripletTile(meld: Meld) {
  if (meld.type === 'CHOW') return undefined;
  return meld.tiles.find((tile) => tile !== XIAO_JI) ?? meld.tiles[0];
}

function tripletLikeTiles(player: PlayerState) {
  const counts = countTiles(player.hand);
  const handTriplets = counts.flatMap((count, tile) => (count >= 3 ? [tile] : []));
  const meldTriplets = player.melds.map(meldTripletTile).filter((tile): tile is number => tile !== undefined);
  return [...handTriplets, ...meldTriplets];
}

function pairTiles(player: PlayerState) {
  const counts = countTiles(player.hand);
  return counts.flatMap((count, tile) => (count >= 2 ? [tile] : []));
}

function isDaDui(player: PlayerState) {
  if (player.melds.some((meld) => meld.type === 'CHOW')) return false;
  const counts = countTiles(player.hand);
  const pairCount = counts.filter((count) => count === 2).length;
  const singleCount = counts.filter((count) => count === 1).length;
  return singleCount === 0 && pairCount === 1;
}

function dragonFan(player: PlayerState) {
  const triplets = new Set(tripletLikeTiles(player).filter(isDragon));
  const pairs = new Set(pairTiles(player).filter(isDragon));
  if ([31, 32, 33].every((tile) => triplets.has(tile))) return { code: 'BIG_THREE_DRAGONS', name: '大三元', fan: 2 };
  if (triplets.size >= 2 && [31, 32, 33].some((tile) => pairs.has(tile) && !triplets.has(tile))) return { code: 'SMALL_THREE_DRAGONS', name: '小三元', fan: 1 };
  return null;
}

function windFan(player: PlayerState) {
  const triplets = new Set(tripletLikeTiles(player).filter(isWind));
  const pairs = new Set(pairTiles(player).filter(isWind));
  if ([27, 28, 29, 30].every((tile) => triplets.has(tile))) return { code: 'BIG_FOUR_WINDS', name: '大四喜', fan: 3 };
  if (triplets.size >= 3 && [27, 28, 29, 30].some((tile) => pairs.has(tile) && !triplets.has(tile))) return { code: 'SMALL_FOUR_WINDS', name: '小四喜', fan: 2 };
  return null;
}

function addFan(items: FanItem[], code: string, name: string, fan: number, description?: string) {
  items.push({ code, name, fan, points: 2 ** fan, description });
}

function analyzeWin(state: GameState, playerIndex: number, tile: number | undefined, source: WinSource): WinAnalysis {
  const player = state.players[playerIndex];
  const tiles = [...player.hand, ...(tile !== undefined ? [tile] : [])];
  const allTiles = [...allPlayerTiles(player), ...(tile !== undefined ? [tile] : [])];
  const allowWild = state.xiaoJiActiveAsWild !== false;
  const openMeldCount = player.melds.length;
  const fanItems: FanItem[] = [];
  const selfDrawLike = source === 'SELF_DRAW' || source === 'ROB_KONG';

  if (countTiles(player.hand)[XIAO_JI] === 4) {
    addFan(fanItems, 'FOUR_XIAO_JI', '四小鸡', 3, '四张小鸡必须都在手牌中，不与其他牌型叠加');
    return { ok: true, code: 'FOUR_XIAO_JI', title: '四小鸡', fan: 3, points: 8, fanItems, usesXiaoJiAsWild: false, basicOnly: false, selfDrawLike: true };
  }

  const special = state.specialRuns?.[playerIndex];
  if (special && !special.brokenByMeld && source === 'SELF_DRAW') {
    if (special.honorDiscards >= 10) {
      addFan(fanItems, 'TEN_HONORS', '十风', 3, '连续打出 10 张字牌，视作自摸');
      return { ok: true, code: 'TEN_HONORS', title: '十风', fan: 3, points: 8, fanItems, usesXiaoJiAsWild: false, basicOnly: false, selfDrawLike: true };
    }
    if (special.yaojiuDiscards >= 13) {
      const fan = special.containsXiaoJiDiscard ? 2 : 3;
      addFan(fanItems, 'THIRTEEN_YAO_DISCARDS', special.containsXiaoJiDiscard ? '十三幺（有鸡）' : '十三幺（无鸡）', fan, '连续打出 13 张字牌或一九牌，视作自摸');
      return { ok: true, code: 'THIRTEEN_YAO_DISCARDS', title: '十三幺', fan, points: 2 ** fan, fanItems, usesXiaoJiAsWild: false, basicOnly: false, selfDrawLike: true };
    }
  }

  const sevenPairs = openMeldCount === 0 ? sevenPairsWildUsage(tiles, allowWild) : { ok: false, wildcardsUsed: 0, hasQuadPair: false };
  const lanPai = openMeldCount === 0 && isLanPai(tiles);
  const qixingLanPai = lanPai && new Set(tiles.filter(isHonor)).size >= 7;
  const standard = standardWinWildUsage(tiles, openMeldCount, allowWild);
  const winningShape = standard.ok || sevenPairs.ok || lanPai;
  if (!winningShape) return { ok: false, code: '', title: '', fan: 0, points: 0, fanItems: [], usesXiaoJiAsWild: false, basicOnly: false, selfDrawLike };

  const usesXiaoJiAsWild = (standard.ok && standard.wildcardsUsed > 0) || (sevenPairs.ok && sevenPairs.wildcardsUsed > 0);

  if (qixingLanPai) addFan(fanItems, 'SEVEN_STAR_LAN_PAI', '七星烂牌', 2, '烂牌且有 7 种不同字牌');
  else if (lanPai) addFan(fanItems, 'LAN_PAI', '烂牌', 1, '烂牌只能叠加无鸡');
  else if (sevenPairs.ok) addFan(fanItems, sevenPairs.hasQuadPair ? 'SEVEN_PAIRS_LONG_BEI' : 'SEVEN_PAIRS', sevenPairs.hasQuadPair ? '小七对龙背' : '小七对', sevenPairs.hasQuadPair ? 3 : 2);
  else addFan(fanItems, 'BASIC_WIN', '底和', 0);

  if (lanPai) {
    if (hasNoXiaoJiAsWild(player, usesXiaoJiAsWild)) addFan(fanItems, 'NO_XIAO_JI', '无鸡', 1);
  } else {
    if (hasNoXiaoJiAsWild(player, usesXiaoJiAsWild)) addFan(fanItems, 'NO_XIAO_JI', '无鸡', 1);
    if (source === 'SELF_DRAW' && isMenQing(player)) addFan(fanItems, 'MEN_QING_SELF_DRAW', '门清自摸', 1);
    if (state.lastDraw?.playerIndex === playerIndex && state.lastDraw.source === 'PUBLIC_KONG' && source === 'SELF_DRAW') {
      const lastTile = state.lastDraw.tile;
      if (lastTile === 13) addFan(fanItems, 'FIVE_MEI_HUA', '五梅花', 2, '杠后摸公开杠牌 5 饼并以此牌和牌');
      else addFan(fanItems, 'KONG_FLOWER', '杠上开花', 1);
    }
    if (source === 'DISCARD' && state.afterKongDiscardFrom !== undefined && state.afterKongDiscardFrom === (state.lastDiscard?.fromPlayer ?? -1)) {
      addFan(fanItems, 'KONG_DISCARD_WIN', '杠上炮', 1);
    }
    const kongCount = player.melds.filter((meld) => meld.type.startsWith('KONG')).length;
    if (kongCount >= 4) addFan(fanItems, 'FOUR_KONGS', '四杠', 3);
    else if (kongCount >= 2) addFan(fanItems, 'DOUBLE_KONG', '双杠', 1);
    if (isQingYiSe(allTiles)) addFan(fanItems, 'QING_YI_SE', allTiles.every(isHonor) ? '字一色' : '清一色', 2);
    else if (isHunYiSe(allTiles)) addFan(fanItems, 'HUN_YI_SE', '混一色', 1);
    if (standard.ok && isDaDui(player)) addFan(fanItems, 'DA_DUI', '大对', 1);
    const dragon = dragonFan(player);
    if (dragon) addFan(fanItems, dragon.code, dragon.name, dragon.fan);
    const wind = windFan(player);
    if (wind) addFan(fanItems, wind.code, wind.name, wind.fan);
    const exposedMelds = player.melds.filter((meld) => meld.type !== 'KONG_CONCEALED').length;
    if (exposedMelds >= 4 && source === 'DISCARD') addFan(fanItems, 'QUAN_QIU_REN', '全求人', 1);
    if (source === 'ROB_KONG') addFan(fanItems, 'ROB_KONG', '抢杠', 0, '底计 3 分，由加杠者包付');
  }

  const nonBasicItems = fanItems.filter((item) => !['BASIC_WIN'].includes(item.code));
  const startingFanItems = fanItems.filter((item) => !['BASIC_WIN', 'NO_XIAO_JI'].includes(item.code));
  const basicOnly = nonBasicItems.length === 0;
  if (source === 'DISCARD' && (basicOnly || (usesXiaoJiAsWild && startingFanItems.length === 0))) {
    return { ok: false, code: '', title: '', fan: 0, points: 0, fanItems: [], usesXiaoJiAsWild, basicOnly: true, selfDrawLike };
  }

  const rawFan = fanItems.reduce((sum, item) => sum + item.fan, 0);
  const fan = Math.min(3, rawFan);
  return {
    ok: true,
    code: fanItems[0]?.code ?? 'BASIC_WIN',
    title: fanItems.map((item) => item.name).join('+') || '底和',
    fan,
    points: source === 'ROB_KONG' ? Math.max(3, 2 ** fan) : 2 ** fan,
    fanItems: fanItems.map((item) => ({ ...item, points: item.code === 'ROB_KONG' ? 3 : 2 ** item.fan })),
    usesXiaoJiAsWild,
    basicOnly,
    selfDrawLike
  };
}

function canWin(player: PlayerState, tile?: number, context: WinContext = 'SELF_DRAW') {
  const tiles = [...player.hand, ...(tile !== undefined ? [tile] : [])];
  const openMeldCount = player.melds.length;
  const fourXiaoJi = countTiles(player.hand)[XIAO_JI] === 4;
  if (fourXiaoJi) return { ok: true, fan: 3, title: '四小鸡', code: 'FOUR_XIAO_JI' };

  if (openMeldCount === 0 && isSevenPairs(tiles)) return { ok: true, fan: 2, title: '小七对', code: 'SEVEN_PAIRS' };
  if (openMeldCount === 0 && isLanPai(tiles)) return { ok: true, fan: 2, title: '烂牌', code: 'LAN_PAI' };
  if (openMeldCount === 0 && isThirteenYao(tiles)) return { ok: true, fan: 3, title: '十三幺', code: 'THIRTEEN_YAO' };
  if (isStandardWin(tiles, openMeldCount)) {
    const fan = context === 'SELF_DRAW' && openMeldCount === 0 ? 1 : 0;
    return { ok: true, fan, title: context === 'SELF_DRAW' ? '自摸胡牌' : '点炮胡牌', code: 'BASIC_WIN' };
  }
  return { ok: false, fan: 0, title: '', code: '' };
}

function canWinInState(state: GameState, playerIndex: number, tile: number | undefined, source: WinSource) {
  return analyzeWin(state, playerIndex, tile, source);
}

function buildSelfActions(state: GameState, playerIndex: number): GameAction[] {
  if (state.status !== 'PLAYING' || state.currentPlayer !== playerIndex) return [];
  const player = state.players[playerIndex];
  const actions: GameAction[] = sortedUnique(player.hand).map((tile) => ({ type: 'DISCARD', tile, actionId: tile }));
  if (canWinInState(state, playerIndex, undefined, 'SELF_DRAW').ok) actions.push({ type: 'WIN', actionId: encodeAction({ type: 'WIN' }) });

  const counts = countTiles(player.hand);
  const allowWild = state.xiaoJiActiveAsWild !== false;
  for (let tile = 0; tile < TILE_TYPE_COUNT; tile += 1) {
    if (counts[tile] === 4 || (allowWild && tile !== XIAO_JI && counts[tile] + counts[XIAO_JI] >= 4 && counts[tile] > 0)) {
      actions.push({ type: 'KONG_CONCEALED', tile, actionId: encodeAction({ type: 'KONG_CONCEALED' }) });
    }
  }
  for (const meld of player.melds) {
    if (meld.type === 'PONG') {
      const tile = meld.tiles[0];
      if (counts[tile] > 0 || (allowWild && tile !== XIAO_JI && counts[XIAO_JI] > 0)) {
        actions.push({ type: 'KONG_ADDED', tile, actionId: encodeAction({ type: 'KONG_ADDED' }) });
      }
    }
  }
  return actions;
}

function responseActions(state: GameState, playerIndex: number, discard: { tile: number; fromPlayer: number }) {
  const player = state.players[playerIndex];
  const tile = discard.tile;
  const counts = countTiles(player.hand);
  const allowWild = state.xiaoJiActiveAsWild !== false;
  const actions: GameAction[] = [];

  if (canWinInState(state, playerIndex, tile, 'DISCARD').ok) actions.push({ type: 'WIN', tile, actionId: encodeAction({ type: 'WIN' }) });
  if (counts[tile] >= 2) actions.push({ type: 'PONG', tile, actionId: encodeAction({ type: 'PONG' }) });
  if (counts[tile] >= 3 || (allowWild && tile !== XIAO_JI && counts[tile] >= 2 && counts[XIAO_JI] >= 1)) {
    actions.push({ type: 'KONG_EXPOSED', tile, actionId: encodeAction({ type: 'KONG_EXPOSED' }) });
  }

  const nextPlayer = (discard.fromPlayer + 1) % state.players.length;
  if (playerIndex === nextPlayer && tile !== XIAO_JI && isSuited(tile)) {
    for (const type of ['CHOW_LEFT', 'CHOW_MIDDLE', 'CHOW_RIGHT'] as const) {
      const need = chowTiles(tile, type);
      if (need && need.every((item) => counts[item] > 0)) actions.push({ type, tile, actionId: encodeAction({ type }) });
    }
  }

  return actions;
}

function priorityFor(action: GameAction) {
  if (action.type === 'WIN') return 4;
  if (action.type === 'KONG_EXPOSED') return 3;
  if (action.type === 'PONG') return 2;
  if (action.type.startsWith('CHOW')) return 1;
  return 0;
}

function drawForPlayer(state: GameState, playerIndex: number, events: GameEvent[]) {
  if (state.wall.length <= drawWallThreshold(state)) return finishDraw(state, events);
  const drawn = state.wall.shift();
  if (drawn === undefined) return finishDraw(state, events);
  state.players[playerIndex].hand.push(drawn);
  state.lastDraw = { playerIndex, tile: drawn, source: 'WALL', stepIndex: state.stepIndex };
  state.currentPlayer = playerIndex;
  state.status = 'PLAYING';
  events.push({ type: 'TILE_DRAWN', playerIndex });
  return undefined;
}

function finishDraw(state: GameState, events: GameEvent[]) {
  state.status = 'FINISHED';
  const result = scoreResult(state, [], undefined, false, true);
  state.result = result;
  events.push({ type: 'SCORE_SETTLED', result });
  return result;
}

function beginKongTileSelection(state: GameState, playerIndex: number, kind: Meld['type'], events: GameEvent[]) {
  if ((state.publicKongTiles?.length ?? 0) <= 1) return takePublicKongTile(state, playerIndex, state.publicKongTiles?.[0], events);
  state.pendingKongSelection = { playerIndex, kind };
  state.currentPlayer = playerIndex;
  state.status = 'PLAYING';
  return undefined;
}

function takePublicKongTile(state: GameState, playerIndex: number, selectedTile: number | undefined, events: GameEvent[]) {
  const publicTiles = state.publicKongTiles ?? [];
  const selectedIndex = selectedTile === undefined ? 0 : publicTiles.findIndex((tile) => tile === selectedTile);
  const replacement = selectedIndex >= 0 ? publicTiles[selectedIndex] : publicTiles.shift() ?? state.wall.pop();
  if (selectedIndex >= 0) publicTiles.splice(selectedIndex, 1);
  if (replacement !== undefined) {
    state.players[playerIndex].hand.push(replacement);
    state.lastDraw = { playerIndex, tile: replacement, source: 'PUBLIC_KONG', stepIndex: state.stepIndex };
    events.push({ type: 'TILE_DRAWN', playerIndex });
  }
  const supplement = state.wall.pop();
  if (supplement !== undefined) publicTiles.push(supplement);
  state.publicKongTiles = publicTiles.slice(0, 2);
  state.pendingKongSelection = undefined;
  if (state.wall.length <= drawWallThreshold(state)) return finishDraw(state, events);
  return undefined;
}

function scoreResult(state: GameState, winners: number[], loser?: number, selfDraw = false, isDraw = false, winningTile?: number, sourceOverride?: WinSource): ScoreResult {
  if (isDraw || winners.length === 0) {
    return {
      scores: [...state.scores],
      reason: 'draw',
      isDraw: true,
      winnerIndexes: [],
      loserIndexes: [],
      scoreDelta: [0, 0, 0, 0],
      title: '流局',
      description: '牌墙达到流局阈值。'
    };
  }

  const scoreDelta = [0, 0, 0, 0];
  const fanItems = winners.map((winner) => {
    const win = analyzeWin(state, winner, winningTile, sourceOverride ?? (selfDraw ? 'SELF_DRAW' : 'DISCARD'));
    return { winner, fan: Math.min(3, win.fan), title: win.title, code: win.code, points: win.points, fanItems: win.fanItems };
  });

  for (const item of fanItems) {
    const points = item.points;
    if (selfDraw) {
      for (let i = 0; i < state.players.length; i += 1) {
        if (i === item.winner) continue;
        scoreDelta[i] -= points;
        scoreDelta[item.winner] += points;
      }
    } else if (loser !== undefined) {
      scoreDelta[loser] -= points;
      scoreDelta[item.winner] += points;
    }
  }

  state.scores = state.scores.map((score, index) => score + scoreDelta[index]);
  state.totalScores = [...state.scores];
  return {
    scores: [...state.scores],
    reason: selfDraw ? 'self_draw_win' : 'discard_win',
    winnerIndexes: winners,
    loserIndexes: selfDraw ? state.players.map((_, index) => index).filter((index) => !winners.includes(index)) : loser !== undefined ? [loser] : [],
    dealer: state.dealer,
    isSelfDraw: selfDraw,
    isDraw: false,
    baseScore: 1,
    cappedFan: Math.max(...fanItems.map((item) => item.fan), 0),
    fanItems: fanItems.flatMap((item) => item.fanItems),
    scoreDelta,
    title: selfDraw ? '自摸胡牌' : '点炮胡牌',
    description: '基础飞小鸡规则结算。'
  };
}

function beginResponses(state: GameState, discard: { tile: number; fromPlayer: number }, events: GameEvent[]) {
  const pending: PendingResponse[] = [];
  for (const player of state.players) {
    if (player.seatIndex === discard.fromPlayer) continue;
    const actions = responseActions(state, player.seatIndex, discard);
    if (actions.length > 0) {
      pending.push({
        playerIndex: player.seatIndex,
        availableActions: actions,
        priority: Math.max(...actions.map(priorityFor))
      });
    }
  }
  if (pending.length === 0) {
    const nextPlayer = (discard.fromPlayer + 1) % state.players.length;
    return drawForPlayer(state, nextPlayer, events);
  }
  state.status = 'WAITING_RESPONSE';
  state.pendingResponses = pending;
  events.push({ type: 'WAITING_RESPONSE', responses: pending });
  return undefined;
}

function removeResponse(state: GameState, playerIndex: number) {
  state.pendingResponses = (state.pendingResponses ?? []).filter((item) => item.playerIndex !== playerIndex);
}

function markMeldBreak(state: GameState, playerIndex: number) {
  const run = state.specialRuns?.[playerIndex];
  if (run) run.brokenByMeld = true;
}

function recordDiscardRun(state: GameState, playerIndex: number, tile: number) {
  const run = state.specialRuns?.[playerIndex];
  if (!run || run.brokenByMeld) return;
  if (isHonor(tile)) run.honorDiscards += 1;
  else run.honorDiscards = -999;
  if (isYaojiu(tile)) run.yaojiuDiscards += 1;
  else run.yaojiuDiscards = -999;
  if (tile === XIAO_JI) run.containsXiaoJiDiscard = true;
}

function normalizeDealer(dealer: number | undefined) {
  if (dealer === undefined || !Number.isInteger(dealer) || dealer < 0 || dealer >= DEFAULT_PLAYER_COUNT) return 0;
  return dealer;
}

export class QujingFeiXiaoJiRuleEngine implements RuleEngine {
  createInitialState(input: CreateGameInput): GameState {
    if (input.players.length !== DEFAULT_PLAYER_COUNT) throw new AppError('RULE_ENGINE_ERROR', 'Qujing Fei Xiao Ji requires exactly 4 players.');
    const wall = shuffleWall(input.seed);
    const publicKongTiles = [wall.pop(), wall.pop()].filter((tile): tile is number => tile !== undefined);
    const players = input.players.map((player) => ({ ...player, hand: [] as number[], melds: [], discards: [], status: 'ACTIVE' as const, isReady: true }));

    for (let round = 0; round < INITIAL_HAND_SIZE; round += 1) {
      for (const player of players) player.hand.push(wall.shift()!);
    }
    const dealer = normalizeDealer(input.dealer);
    players[dealer].hand.push(wall.shift()!);

    const ts = nowMs();
    return {
      gameId: input.gameId,
      roomId: input.roomId,
      ruleVersion: input.ruleVersion,
      seed: input.seed,
      status: 'PLAYING',
      players,
      wall,
      publicKongTiles,
      xiaoJiActiveAsWild: true,
      kongCount: 0,
      specialRuns: players.map(() => ({ honorDiscards: 0, yaojiuDiscards: 0, containsXiaoJiDiscard: false, brokenByMeld: false })),
      currentPlayer: dealer,
      dealer,
      roundIndex: Math.max(0, (input.currentRound ?? 1) - 1),
      currentRound: input.currentRound ?? 1,
      maxRounds: input.maxRounds ?? 1,
      stepIndex: 0,
      scores: [0, 0, 0, 0],
      totalScores: input.totalScores ?? [0, 0, 0, 0],
      createdAt: ts,
      updatedAt: ts
    };
  }

  getLegalActions(state: GameState, playerIndex: number): GameAction[] {
    if (state.pendingKongSelection) {
      if (state.pendingKongSelection.playerIndex !== playerIndex) return [];
      return (state.publicKongTiles ?? []).slice(0, 2).map((tile) => ({
        type: 'SELECT_KONG_TILE',
        tile,
        actionId: encodeAction({ type: 'SELECT_KONG_TILE' })
      }));
    }
    if (state.status === 'WAITING_RESPONSE') {
      const pending = state.pendingResponses?.find((item) => item.playerIndex === playerIndex);
      if (!pending) return [];
      const highest = Math.max(...(state.pendingResponses ?? []).flatMap((item) => item.availableActions.map(priorityFor)));
      const playerHighest = Math.max(...pending.availableActions.map(priorityFor));
      const available = playerHighest >= highest ? pending.availableActions : pending.availableActions.filter((action) => priorityFor(action) >= highest);
      return [...available, { type: 'PASS', actionId: encodeAction({ type: 'PASS' }) }];
    }
    return buildSelfActions(state, playerIndex);
  }

  applyAction(state: GameState, playerIndex: number, action: GameAction): RuleResult {
    const legal = this.getLegalActions(state, playerIndex);
    if (!legal.some((item) => sameAction(item, action))) throw new AppError('ILLEGAL_ACTION', 'Action is not legal in current state.');

    const nextState = cloneState(state);
    const events: GameEvent[] = [];
    let score: ScoreResult | undefined;
    const player = nextState.players[playerIndex];

    if (nextState.pendingKongSelection) {
      if (action.type !== 'SELECT_KONG_TILE' || action.tile === undefined) throw new AppError('ILLEGAL_ACTION', 'Kong tile selection is required.');
      score = takePublicKongTile(nextState, playerIndex, action.tile, events);
    } else if (nextState.status === 'WAITING_RESPONSE') {
      if (action.type === 'PASS') {
        removeResponse(nextState, playerIndex);
        if ((nextState.pendingResponses ?? []).length === 0 && nextState.lastDiscard) {
          score = drawForPlayer(nextState, (nextState.lastDiscard.fromPlayer + 1) % nextState.players.length, events);
          nextState.pendingResponses = [];
        }
      } else if (action.type === 'WIN' && nextState.lastDiscard) {
        const winners = (nextState.pendingResponses ?? [])
          .filter((pending) => pending.availableActions.some((item) => item.type === 'WIN'))
          .map((pending) => pending.playerIndex);
        score = scoreResult(nextState, winners, nextState.lastDiscard.fromPlayer, false, false, nextState.lastDiscard.tile);
        nextState.status = 'FINISHED';
        nextState.result = score;
        events.push(...winners.map((winner) => ({ type: 'WIN_DECLARED' as const, playerIndex: winner })));
        events.push({ type: 'SCORE_SETTLED', result: score });
      } else if (nextState.lastDiscard) {
        const discard = nextState.lastDiscard;
        const highest = Math.max(...(nextState.pendingResponses ?? []).flatMap((pending) => pending.availableActions.map(priorityFor)));
        const pending = nextState.pendingResponses?.find((item) => item.playerIndex === playerIndex);
        const playerHighest = Math.max(...(pending?.availableActions ?? []).map(priorityFor));
        if (playerHighest < highest || !pending?.availableActions.some((item) => sameAction(item, action))) {
          throw new AppError('ILLEGAL_ACTION', 'Higher priority response is still available.');
        }
        this.applyMeldResponse(nextState, playerIndex, action, discard, events);
      }
    } else if (action.type === 'WIN') {
      score = scoreResult(nextState, [playerIndex], undefined, true, false);
      nextState.status = 'FINISHED';
      nextState.result = score;
      events.push({ type: 'WIN_DECLARED', playerIndex });
      events.push({ type: 'SCORE_SETTLED', result: score });
    } else if (action.type === 'DISCARD' && action.tile !== undefined) {
      const hand = removeTiles(player.hand, [action.tile]);
      if (!hand) throw new AppError('ILLEGAL_ACTION', 'Tile is not in player hand.');
      player.hand = hand;
      player.discards.push(action.tile);
      recordDiscardRun(nextState, playerIndex, action.tile);
      if (action.tile === XIAO_JI) nextState.xiaoJiActiveAsWild = false;
      nextState.lastDiscard = { tile: action.tile, fromPlayer: playerIndex, stepIndex: nextState.stepIndex };
      nextState.afterKongDiscardFrom = nextState.lastKong?.playerIndex === playerIndex ? playerIndex : undefined;
      events.push({ type: 'TILE_DISCARDED', playerIndex, tile: action.tile });
      score = beginResponses(nextState, nextState.lastDiscard, events);
    } else if (['KONG_CONCEALED', 'KONG_ADDED'].includes(action.type) && action.tile !== undefined) {
      this.applySelfKong(nextState, playerIndex, action, events);
      score = beginKongTileSelection(nextState, playerIndex, action.type as 'KONG_CONCEALED' | 'KONG_ADDED', events);
    }

    nextState.lastAction = action;
    nextState.stepIndex += 1;
    nextState.updatedAt = nowMs();
    return { nextState, events, scoreResult: score };
  }

  private applyMeldResponse(state: GameState, playerIndex: number, action: GameAction, discard: { tile: number; fromPlayer: number; stepIndex: number }, events: GameEvent[]) {
    const player = state.players[playerIndex];
    let used: number[] = [];
    let meld: Meld;
    if (action.type === 'PONG') {
      used = [discard.tile, discard.tile];
      meld = {
        type: 'PONG',
        tiles: [discard.tile, discard.tile, discard.tile],
        fromPlayer: discard.fromPlayer,
        stepIndex: state.stepIndex,
        claimedIndex: 1,
      };
    } else if (action.type === 'KONG_EXPOSED') {
      const counts = countTiles(player.hand);
      used = counts[discard.tile] >= 3 || state.xiaoJiActiveAsWild === false ? [discard.tile, discard.tile, discard.tile] : [discard.tile, discard.tile, XIAO_JI];
      meld = {
        type: 'KONG_EXPOSED',
        tiles: [discard.tile, ...used],
        fromPlayer: discard.fromPlayer,
        stepIndex: state.stepIndex,
        containsXiaoJiAsWild: used.includes(XIAO_JI),
        claimedIndex: 0,
      };
    } else {
      const need = chowTiles(discard.tile, action.type);
      if (!need) throw new AppError('ILLEGAL_ACTION', 'Invalid chow.');
      used = need;
      const sortedChowTiles = [discard.tile, ...need].sort((a, b) => a - b);
      meld = {
        type: 'CHOW',
        tiles: sortedChowTiles,
        fromPlayer: discard.fromPlayer,
        stepIndex: state.stepIndex,
        claimedIndex: sortedChowTiles.indexOf(discard.tile),
      };
    }

    const hand = removeTiles(player.hand, used);
    if (!hand) throw new AppError('ILLEGAL_ACTION', 'Required tiles are not in hand.');
    player.hand = hand;
    player.melds.push(meld);
    markMeldBreak(state, playerIndex);
    if (action.type.startsWith('CHOW') && (discard.tile === XIAO_JI || used.includes(XIAO_JI))) state.xiaoJiActiveAsWild = false;
    state.status = 'PLAYING';
    state.currentPlayer = playerIndex;
    state.pendingResponses = [];
    events.push({ type: 'MELD_CREATED', playerIndex, meld });
    if (action.type === 'KONG_EXPOSED') {
      state.kongCount = (state.kongCount ?? 0) + 1;
      state.lastKong = { playerIndex, stepIndex: state.stepIndex, kind: 'KONG_EXPOSED' };
      beginKongTileSelection(state, playerIndex, 'KONG_EXPOSED', events);
    }
  }

  private applySelfKong(state: GameState, playerIndex: number, action: GameAction, events: GameEvent[]) {
    const player = state.players[playerIndex];
    const tile = action.tile!;
    if (action.type === 'KONG_ADDED') {
      const meld = player.melds.find((item) => item.type === 'PONG' && item.tiles[0] === tile);
      if (!meld) throw new AppError('ILLEGAL_ACTION', 'No pong meld to upgrade.');
      const hand = removeTiles(player.hand, player.hand.includes(tile) || state.xiaoJiActiveAsWild === false ? [tile] : [XIAO_JI]);
      if (!hand) throw new AppError('ILLEGAL_ACTION', 'Missing tile for added kong.');
      player.hand = hand;
      meld.type = 'KONG_ADDED';
      meld.tiles.push(tile);
      meld.claimedIndex = meld.tiles.length - 1;
      meld.containsXiaoJiAsWild = meld.containsXiaoJiAsWild || !player.hand.includes(tile);
      state.kongCount = (state.kongCount ?? 0) + 1;
      state.lastKong = { playerIndex, stepIndex: state.stepIndex, kind: 'KONG_ADDED' };
      events.push({ type: 'MELD_CREATED', playerIndex, meld });
      return;
    }

    const counts = countTiles(player.hand);
    const used = counts[tile] >= 4 || state.xiaoJiActiveAsWild === false ? [tile, tile, tile, tile] : [tile, ...Array.from({ length: 4 - counts[tile] }, () => XIAO_JI), ...Array.from({ length: Math.max(0, counts[tile] - 1) }, () => tile)].slice(0, 4);
    const hand = removeTiles(player.hand, used);
    if (!hand) throw new AppError('ILLEGAL_ACTION', 'Missing tiles for concealed kong.');
    const meld: Meld = { type: 'KONG_CONCEALED', tiles: used, stepIndex: state.stepIndex, containsXiaoJiAsWild: used.includes(XIAO_JI) && tile !== XIAO_JI };
    player.hand = hand;
    player.melds.push(meld);
    state.kongCount = (state.kongCount ?? 0) + 1;
    state.lastKong = { playerIndex, stepIndex: state.stepIndex, kind: 'KONG_CONCEALED' };
    events.push({ type: 'MELD_CREATED', playerIndex, meld });
  }

  buildPlayerView(state: GameState, playerIndex: number) {
    return buildPlayerGameView(state, playerIndex, this);
  }

  isTerminal(state: GameState) {
    return state.status === 'FINISHED';
  }

  score(state: GameState) {
    return (state.result as ScoreResult | undefined) ?? scoreResult(state, [], undefined, false, true);
  }

  hashState(state: GameState) {
    return hashJson(state);
  }
}
