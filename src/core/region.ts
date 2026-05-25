import { ARENA_X_MAX, ARENA_X_MIN, ARENA_Y_MAX, ARENA_Y_MIN, PILLAR_LOCS } from '../data/arena';
import type { Entity, Mob, PillarConfig, PillarKey, Region, Tile } from '../types';
import { collidesWithEntities, collidesWithMobs } from './geometry';

export function createRegion(pillarConfig: PillarConfig): Region {
  const entities: Entity[] = [];
  for (let x = ARENA_X_MIN - 1; x <= ARENA_X_MAX + 1; x++) {
    entities.push({ x, y: ARENA_Y_MIN - 1, size: 1 });
    entities.push({ x, y: ARENA_Y_MAX + 1, size: 1 });
  }
  for (let y = ARENA_Y_MIN; y <= ARENA_Y_MAX; y++) {
    entities.push({ x: ARENA_X_MIN - 1, y, size: 1 });
    entities.push({ x: ARENA_X_MAX + 1, y, size: 1 });
  }
  const p2: Region['pillars'] = [];
  const pillarPairs: ReadonlyArray<[PillarKey, (typeof PILLAR_LOCS)[PillarKey]]> = [
    ['S', PILLAR_LOCS.S],
    ['W', PILLAR_LOCS.W],
    ['N', PILLAR_LOCS.N],
  ];
  for (const [key, loc] of pillarPairs) {
    if (pillarConfig[key]) {
      const p = {
        x: loc.x,
        y: loc.y,
        size: 3,
        hp: 255,
        maxHp: 255,
        isPillar: true as const,
        dead: false,
        id: `pillar${key}`,
      };
      p2.push(p);
      entities.push(p);
    }
  }
  // Precompute blocked tile grid for O(1) entity collision lookups
  const blocked = new Uint8Array(4096); // 64×64 grid, index = (x<<6)|y
  for (const e of entities) {
    const ex1 = e.x + e.size - 1;
    const ey0 = e.y - e.size + 1;
    for (let ex = e.x; ex <= ex1; ex++) {
      for (let ey = ey0; ey <= e.y; ey++) blocked[(ex << 6) | ey] = 1;
    }
  }
  return { entities, pillars: p2, blocked };
}

export function findRespawnLocation(size: number, region: Region, mobs: Mob[]): Tile {
  for (let x = 16; x < 23; x++) {
    for (let y = 11; y < 24; y++) {
      if (!collidesWithMobs(x, y, size, mobs, null) && !collidesWithEntities(x, y, size, region.entities))
        return { x, y };
    }
  }
  return { x: 11, y: 9 };
}
