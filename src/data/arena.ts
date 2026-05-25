import type { PillarKey, Tile } from '../types';

export const ARENA_X_MIN = 1;
export const ARENA_X_MAX = 29;
export const ARENA_Y_MIN = 1;
export const ARENA_Y_MAX = 30;
export const ARENA_W = ARENA_X_MAX - ARENA_X_MIN + 1;
export const ARENA_H = ARENA_Y_MAX - ARENA_Y_MIN + 1;

export const SPAWN_LOCATIONS: readonly Tile[] = [
  { x: 2, y: 6 },
  { x: 23, y: 6 },
  { x: 4, y: 12 },
  { x: 24, y: 13 },
  { x: 17, y: 18 },
  { x: 6, y: 24 },
  { x: 24, y: 26 },
  { x: 2, y: 29 },
  { x: 16, y: 29 },
];

export interface PillarLocation {
  x: number;
  y: number;
  size: number;
}

export const PILLAR_LOCS: Record<PillarKey, PillarLocation> = {
  S: { x: 11, y: 24, size: 3 },
  W: { x: 1, y: 10, size: 3 },
  N: { x: 18, y: 8, size: 3 },
};

export const BFS_DIRS: ReadonlyArray<readonly [number, number]> = [
  [-1, 0],
  [1, 0],
  [0, 1],
  [0, -1],
  [-1, 1],
  [1, 1],
  [-1, -1],
  [1, -1],
];

export const DEATH_ANIM_TICKS = 3;
