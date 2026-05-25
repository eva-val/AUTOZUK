import type { Mob, Player, Region } from '../types';
import { chebyshev, closestTileTo, closestTileToScratch, collisionMath, SCRATCH_CX, SCRATCH_CY } from './geometry';

export function isWithinMeleeRange(mob: Mob, target: { x: number; y: number }): boolean {
  const dx = target.x - mob.x;
  const dy = target.y - mob.y;
  const s = mob.size;
  return (dx < s && dx >= 0 && (dy === 1 || dy === -s)) || (dy > -s && dy <= 0 && (dx === -1 || dx === s));
}

export function isWithinSecondaryMeleeRange(mob: Mob, target: { x: number; y: number }): boolean {
  // Ranger/mager/blob secondary melee can hit 1 tile from their footprint in any direction, including diagonals.
  const ct = closestTileTo(mob, target.x, target.y);
  return chebyshev(target.x, target.y, ct.x, ct.y) === 1;
}

export function canUseSecondaryMelee(mob: Mob, player: Player): boolean {
  return (
    (mob.type === 'mager' || mob.type === 'ranger' || mob.type === 'blob') && isWithinSecondaryMeleeRange(mob, player)
  );
}

export function isUnderMob(mob: Mob, player: Player): boolean {
  return collisionMath(mob.x, mob.y, mob.size, player.x, player.y, 1);
}

export function raycast(region: Region, x1: number, y1: number, x2: number, y2: number): boolean {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dxAbs = Math.abs(dx);
  const dyAbs = Math.abs(dy);
  const bl = region.blocked;
  if (dxAbs === 0 && dyAbs === 0) return true;
  if (dxAbs > dyAbs) {
    const xInc = dx > 0 ? 1 : -1;
    const slope = ((dy << 16) / dxAbs) | 0;
    let y = (y1 << 16) + 0x8000;
    if (dy < 0) y -= 1;
    let xTile = x1;
    while (xTile !== x2) {
      xTile += xInc;
      const yTile = y >>> 16;
      if (bl[(xTile << 6) | yTile]) return false;
      y += slope;
      const ny = y >>> 16;
      if (ny !== yTile && bl[(xTile << 6) | ny]) return false;
    }
  } else {
    const yInc = dy > 0 ? 1 : -1;
    const slope = ((dx << 16) / dyAbs) | 0;
    let x = (x1 << 16) + 0x8000;
    if (dx < 0) x -= 1;
    let yTile = y1;
    while (yTile !== y2) {
      yTile += yInc;
      const xTile = x >>> 16;
      if (bl[(xTile << 6) | yTile]) return false;
      x += slope;
      const nx = x >>> 16;
      if (nx !== xTile && bl[(nx << 6) | yTile]) return false;
    }
  }
  return true;
}

export function hasLineOfSight(
  region: Region,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  s: number,
  r: number,
  isNPC: boolean
): boolean {
  const bl = region.blocked;
  if (bl[(x1 << 6) | y1] || bl[(x2 << 6) | y2]) return false;
  if (collisionMath(x1, y1, s, x2, y2, 1)) return false;
  if (r === 1) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return (dx < s && dx >= 0 && (dy === 1 || dy === -s)) || (dy > -s && dy <= 0 && (dx === -1 || dx === s));
  }
  if (isNPC) {
    const tx = Math.max(x1, Math.min(x1 + s - 1, x2));
    const ty = Math.max(y1 - s + 1, Math.min(y1, y2));
    return hasLineOfSight(region, x2, y2, tx, ty, 1, r, false);
  }
  if (Math.abs(x2 - x1) > r || Math.abs(y2 - y1) > r) return false;
  return raycast(region, x1, y1, x2, y2);
}

export function mobHasLOS(region: Region, mob: Mob, target: Player): boolean {
  return mob.range === 1
    ? isWithinMeleeRange(mob, target)
    : hasLineOfSight(region, mob.x, mob.y, target.x, target.y, mob.size, mob.range, true);
}

export function playerHasLOS(region: Region, px: number, py: number, mob: Mob, range: number): boolean {
  closestTileToScratch(mob, px, py);
  return hasLineOfSight(region, px, py, SCRATCH_CX, SCRATCH_CY, 1, range, false);
}
