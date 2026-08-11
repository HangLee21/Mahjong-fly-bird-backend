export type DiceRoll = { first: number; second: number };
export type PublicKongSlot = { visible: number; hidden?: number };

const STACKS_PER_PLAYER = 17;
const TOTAL_STACKS = 68;

function fnv1a(text: string) {
  let h = 2166136261;
  for (const ch of text) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function nextHash(h: number) {
  h ^= h << 13;
  h ^= h >>> 17;
  h ^= h << 5;
  return h >>> 0;
}

function mod(value: number, base: number) {
  return ((value % base) + base) % base;
}

/**
 * Deterministic dice roll derived from the game seed (substitutes physical dice).
 */
export function rollDice(seed: string): DiceRoll {
  let h = fnv1a(seed);
  const first = (h % 6) + 1;
  h = nextHash(h);
  const second = (h % 6) + 1;
  return { first, second };
}

/**
 * Wall-section offset relative to the dealer for each dice sum (规则 2.1 开牌点数表):
 * 5/9 dealer, 2/6/10 next player, 3/7/11 opposite, 4/8/12 previous player.
 */
function startingWallOffset(sum: number) {
  if (sum === 5 || sum === 9) return 0;
  if (sum === 2 || sum === 6 || sum === 10) return 1;
  if (sum === 3 || sum === 7 || sum === 11) return 2;
  return 3;
}

/**
 * Deals a fresh round according to 规则 2.1:
 * - dice pick the starting wall and the skip count (min dice) from its right end;
 * - three rounds of two whole stacks per player (12 tiles each);
 * - the dealer 跳牌 (skips one stack) and takes the top tile of the two stacks
 *   around it, then the other three players take one top tile each;
 * - the top tiles of the last two stacks become the public kong tiles (公开杠牌),
 *   keeping their below tiles as hidden slot tiles.
 *
 * The wall ring is indexed 0..67 (17 stacks per seat). It is consumed in
 * increasing index order; the public kong stacks are the two stacks immediately
 * before the draw-start stack. The returned wall is the remaining drawable
 * tiles in draw order (top first), with the public area excluded.
 */
export function dealInitialHands(seed: string, tiles: number[], dealer: number) {
  const dice = rollDice(seed);
  const stacks: number[][] = [];
  for (let i = 0; i < TOTAL_STACKS; i += 1) stacks.push([tiles[2 * i], tiles[2 * i + 1]]);
  const stackAt = (index: number) => stacks[mod(index, TOTAL_STACKS)];

  const sum = dice.first + dice.second;
  const startSeat = (dealer + startingWallOffset(sum)) % 4;
  const sectionEnd = startSeat * STACKS_PER_PLAYER + STACKS_PER_PLAYER - 1;
  const skip = Math.min(dice.first, dice.second);
  const drawStart = mod(sectionEnd - skip, TOTAL_STACKS);

  const hands: number[][] = [0, 1, 2, 3].map(() => []);

  // Three rounds: each player takes two whole stacks per round (12 tiles each).
  for (let round = 0; round < 3; round += 1) {
    for (let k = 0; k < 4; k += 1) {
      const seat = (dealer + k) % 4;
      const base = round * 8 + k * 2;
      hands[seat].push(...stackAt(drawStart + base).splice(0, 2));
      hands[seat].push(...stackAt(drawStart + base + 1).splice(0, 2));
    }
  }

  // 跳牌: dealer skips one stack and takes the top tiles of the stacks around it.
  const jumpBase = drawStart + 24;
  hands[dealer].push(stackAt(jumpBase + 1).shift()!);
  hands[dealer].push(stackAt(jumpBase + 3).shift()!);
  hands[(dealer + 1) % 4].push(stackAt(jumpBase + 4).shift()!);
  hands[(dealer + 2) % 4].push(stackAt(jumpBase + 5).shift()!);
  hands[(dealer + 3) % 4].push(stackAt(jumpBase + 6).shift()!);

  // Public kong area: top tiles of the last two stacks before the draw start.
  const publicSlotA = stackAt(drawStart - 2);
  const publicSlotB = stackAt(drawStart - 1);
  const publicKongSlots: PublicKongSlot[] = [
    { visible: publicSlotA.shift()!, hidden: publicSlotA.shift() },
    { visible: publicSlotB.shift()!, hidden: publicSlotB.shift() }
  ];

  // Remaining drawable wall in draw order, excluding the public kong stacks.
  const wall: number[] = [];
  const pushStack = (index: number) => wall.push(...stackAt(index));
  const pushTop = (index: number) => {
    const tile = stackAt(index).shift();
    if (tile !== undefined) wall.push(tile);
  };
  pushStack(jumpBase + 0); // untouched stack at the deal position
  pushTop(jumpBase + 1); // bottom of the dealer's first 跳牌 stack
  pushStack(jumpBase + 2); // skipped 跳牌 stack (still fully in the wall)
  pushTop(jumpBase + 3); // bottom of the dealer's second 跳牌 stack
  pushTop(jumpBase + 4); // bottoms of the three single-tile draws
  pushTop(jumpBase + 5);
  pushTop(jumpBase + 6);
  const fullStackCount = mod(drawStart - 3 - (jumpBase + 7) + 1, TOTAL_STACKS);
  for (let i = 0; i < fullStackCount; i += 1) pushStack(jumpBase + 7 + i);

  return { hands, wall, publicKongSlots, dice };
}
