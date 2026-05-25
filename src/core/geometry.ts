import type { Entity, Mob } from '../types';

export function chebyshev(x1: number, y1: number, x2: number, y2: number): number {
  return Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
}

export function collisionMath(x: number, y: number, s: number, x2: number, y2: number, s2: number): boolean {
  return !(x > x2 + s2 - 1 || x + s - 1 < x2 || y - s + 1 > y2 || y < y2 - s2 + 1);
}

export function closestTileTo(mob: Mob, tx: number, ty: number): { x: number; y: number } {
  return {
    x: Math.max(mob.x, Math.min(mob.x + mob.size - 1, tx)),
    y: Math.max(mob.y - mob.size + 1, Math.min(mob.y, ty)),
  };
}

// Scratch globals to avoid per-call {x,y} allocations in the hot LOS / distance paths.
// Read SCRATCH_CX / SCRATCH_CY after calling closestTileToScratch.
export let SCRATCH_CX = 0;
export let SCRATCH_CY = 0;
export function closestTileToScratch(mob: Mob, tx: number, ty: number): void {
  const mx = mob.x;
  const my = mob.y;
  const s = mob.size;
  const mxRight = mx + s - 1;
  SCRATCH_CX = tx < mx ? mx : tx > mxRight ? mxRight : tx;
  const myBottom = my - s + 1;
  SCRATCH_CY = ty < myBottom ? myBottom : ty > my ? my : ty;
}

export function distToMob(px: number, py: number, mob: Mob): number {
  const mx = mob.x;
  const my = mob.y;
  const s = mob.size;
  const mxRight = mx + s - 1;
  const cx = px < mx ? mx : px > mxRight ? mxRight : px;
  const myBottom = my - s + 1;
  const cy = py < myBottom ? myBottom : py > my ? my : py;
  const dx = px > cx ? px - cx : cx - px;
  const dy = py > cy ? py - cy : cy - py;
  return dx > dy ? dx : dy;
}

export function collidesWithEntities(x: number, y: number, s: number, entities: Entity[]): boolean {
  for (const e of entities) {
    if (collisionMath(x, y, s, e.x, e.y, e.size)) return true;
  }
  return false;
}

// O(1)-per-cell mob occupancy grid. Indexed (x << 6) | y; cell value is mob._gridCell
// (mob index + 1, so 0 means empty). Sized to fit the 30×30 arena with 1-tile padding.
export const MOB_GRID_SIZE = 4096;

export function stampMobOnGrid(grid: Int16Array, mob: Mob): void {
  const cell = mob._gridCell;
  if (cell === 0) return;
  const s = mob.size;
  const x = mob.x;
  const yBot = mob.y - s + 1;
  for (let xi = 0; xi < s; xi++) {
    const base = (x + xi) << 6;
    for (let yi = 0; yi < s; yi++) grid[base | (yBot + yi)] = cell;
  }
}

export function clearMobFromGrid(grid: Int16Array, mob: Mob): void {
  // Honor the "only clear cells that still belong to this mob" invariant — bloblets
  // are spawned inside their parent blob's footprint, so the parent's death-time
  // clear must not wipe the bloblets that overstamped.
  const cell = mob._gridCell;
  if (cell === 0) return;
  const s = mob.size;
  const x = mob.x;
  const yBot = mob.y - s + 1;
  for (let xi = 0; xi < s; xi++) {
    const base = (x + xi) << 6;
    for (let yi = 0; yi < s; yi++) {
      const idx = base | (yBot + yi);
      if (grid[idx] === cell) grid[idx] = 0;
    }
  }
  // Bloblets vacating a cell inside their parent's still-dying footprint must restore
  // the parent's logical presence, otherwise queries see an empty cell while the parent
  // still occupies it for collision purposes.
  const parent = mob._parentRef;
  if (parent !== null && parent.dying > 0) {
    const pCell = parent._gridCell;
    if (pCell !== 0) {
      const ps = parent.size;
      const px = parent.x;
      const pyBot = parent.y - ps + 1;
      for (let xi = 0; xi < ps; xi++) {
        const base = (px + xi) << 6;
        for (let yi = 0; yi < ps; yi++) {
          const idx = base | (pyBot + yi);
          if (grid[idx] === 0) grid[idx] = pCell;
        }
      }
    }
  }
}

export function collidesWithMobs(
  x: number,
  y: number,
  s: number,
  mobs: Mob[],
  exclude: Mob | null,
  skipNibblers = false,
  grid?: Int16Array
): Mob | null {
  if (grid !== undefined) {
    // Fast path: walk the s×s footprint of (x, y) and look up occupants directly.
    const yBot = y - s + 1;
    for (let xi = 0; xi < s; xi++) {
      const base = (x + xi) << 6;
      for (let yi = 0; yi < s; yi++) {
        const cell = grid[base | (yBot + yi)]!;
        if (cell === 0) continue;
        const m = mobs[cell - 1];
        if (m === undefined || m === exclude || m.dead) continue;
        if (exclude && exclude.parentBlobId === m.id && m.dying > 0) continue;
        if (skipNibblers && m.type === 'nibbler') continue;
        return m;
      }
    }
    return null;
  }
  for (const m of mobs) {
    if (m === exclude || m.dead) continue;
    if (exclude && exclude.parentBlobId === m.id && m.dying > 0) continue;
    if (skipNibblers && m.type === 'nibbler') continue;
    if (collisionMath(x, y, s, m.x, m.y, m.size)) return m;
  }
  return null;
}
