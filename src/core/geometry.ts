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

export function collidesWithMobs(
  x: number,
  y: number,
  s: number,
  mobs: Mob[],
  exclude: Mob | null,
  skipNibblers = false
): Mob | null {
  for (const m of mobs) {
    if (m === exclude || m.dead) continue;
    if (exclude && exclude.parentBlobId === m.id && m.dying > 0) continue;
    if (skipNibblers && m.type === 'nibbler') continue;
    if (collisionMath(x, y, s, m.x, m.y, m.size)) return m;
  }
  return null;
}
