import { COPIES_PER_TILE, TILE_TYPE_COUNT } from '../config/constants.js';

export function createWall(): number[] {
  const wall: number[] = [];
  for (let tile = 0; tile < TILE_TYPE_COUNT; tile += 1) {
    for (let copy = 0; copy < COPIES_PER_TILE; copy += 1) wall.push(tile);
  }
  return wall;
}

export function shuffleWall(seed: string): number[] {
  const wall = createWall();
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);

  for (let i = wall.length - 1; i > 0; i -= 1) {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    const j = Math.abs(h) % (i + 1);
    [wall[i], wall[j]] = [wall[j], wall[i]];
  }
  return wall;
}

export function countTiles(tiles: number[]) {
  const counts = Array.from({ length: TILE_TYPE_COUNT }, () => 0);
  for (const tile of tiles) counts[tile] += 1;
  return counts;
}
