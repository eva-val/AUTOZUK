import { ARENA_X_MAX, ARENA_X_MIN, ARENA_Y_MAX, ARENA_Y_MIN, BFS_DIRS } from '../data/arena';
import type { Mob, Region, Tile } from '../types';
import { chebyshev } from './geometry';

export interface FaceTile extends Tile {
  isNS: boolean;
}

// Find closest face tile (melee-adjacent, non-diagonal) with N/S priority on ties, Manhattan tiebreaker
export function getClosestFaceTile(mob: Mob, px: number, py: number, region: Region): FaceTile | null {
  const s = mob.size;
  const mx = mob.x;
  const my = mob.y;
  const bl = region.blocked;
  let bestDist = Infinity;
  let bestMan = Infinity;
  let bestTile: FaceTile | null = null;

  function check(x: number, y: number, isNS: boolean): void {
    if (bl[(x << 6) | y]) return;
    const d = chebyshev(px, py, x, y);
    const m = Math.abs(px - x) + Math.abs(py - y);
    // Priority: 1) smallest Chebyshev, 2) N/S over E/W at same Chebyshev, 3) smallest Manhattan
    if (
      d < bestDist ||
      (d === bestDist && isNS && bestTile !== null && !bestTile.isNS) ||
      (d === bestDist && isNS === (bestTile === null || bestTile.isNS) && m < bestMan)
    ) {
      bestDist = d;
      bestMan = m;
      bestTile = { x, y, isNS };
    }
  }
  // South face
  for (let x = mx; x < mx + s; x++) check(x, my + 1, true);
  // North face
  for (let x = mx; x < mx + s; x++) check(x, my - s, true);
  // West face
  if (mx - 1 >= ARENA_X_MIN) for (let y = my - s + 1; y <= my; y++) check(mx - 1, y, false);
  // East face
  if (mx + s <= ARENA_X_MAX) for (let y = my - s + 1; y <= my; y++) check(mx + s, y, false);
  return bestTile;
}

interface BFSNode {
  x: number;
  y: number;
  parent: BFSNode | null;
}

// BFS pathfinder for player: only entity collision, can walk through mobs
export function playerBFS(sx: number, sy: number, tx: number, ty: number, region: Region): Tile | null {
  if (sx === tx && sy === ty) return null;
  const bl = region.blocked;
  const visited = new Uint8Array(4096); // 64×64
  visited[(sx << 6) | sy] = 1;
  // Directions: W,E,S,N,SW,SE,NW,NE (cardinal first, matches BFS_DIRS)
  const queue: BFSNode[] = [{ x: sx, y: sy, parent: null }];
  let qi = 0;
  while (qi < queue.length && queue.length < 2000) {
    const node = queue[qi++]!;
    if (node.x === tx && node.y === ty) {
      // Backtrack to find first step
      let step: BFSNode = node;
      while (step.parent && !(step.parent.x === sx && step.parent.y === sy)) step = step.parent;
      return { x: step.x, y: step.y };
    }
    for (let d = 0; d < 8; d++) {
      const dir = BFS_DIRS[d]!;
      const nx = node.x + dir[0];
      const ny = node.y + dir[1];
      if (nx < ARENA_X_MIN || nx > ARENA_X_MAX || ny < ARENA_Y_MIN || ny > ARENA_Y_MAX) continue;
      const key = (nx << 6) | ny;
      if (visited[key]) continue;
      if (bl[key]) continue;
      // Diagonal: check both cardinal neighbors
      if (d >= 4) {
        if (bl[((node.x + dir[0]) << 6) | node.y]) continue;
        if (bl[(node.x << 6) | (node.y + dir[1])]) continue;
      }
      visited[key] = 1;
      queue.push({ x: nx, y: ny, parent: node });
    }
  }
  // No path found — try to get as close as possible (backup: direct step)
  const dx = Math.sign(tx - sx);
  const dy = Math.sign(ty - sy);
  const nx = sx + dx;
  const ny = sy + dy;
  if (dx !== 0 && dy !== 0) {
    if (!bl[(nx << 6) | ny] && !bl[((sx + dx) << 6) | sy] && !bl[(sx << 6) | (sy + dy)]) return { x: nx, y: ny };
    if (!bl[((sx + dx) << 6) | sy]) return { x: sx + dx, y: sy };
    if (!bl[(sx << 6) | (sy + dy)]) return { x: sx, y: sy + dy };
  } else if (dx !== 0 && !bl[(nx << 6) | ny]) return { x: nx, y: ny };
  else if (dy !== 0 && !bl[(nx << 6) | ny]) return { x: nx, y: ny };
  return null;
}

// OSRS-style single walk step: straight in longer axis first, then diagonal
// Falls back to BFS if the direct step is blocked
export function osrsWalkStep(sx: number, sy: number, tx: number, ty: number, region: Region): Tile | null {
  if (sx === tx && sy === ty) return null;
  const dx = tx - sx;
  const dy = ty - sy;
  const dxA = Math.abs(dx);
  const dyA = Math.abs(dy);
  const xs = Math.sign(dx);
  const ys = Math.sign(dy);
  const bl = region.blocked;
  let nx: number;
  let ny: number;
  if (dxA > dyA) {
    nx = sx + xs;
    ny = sy;
  } else if (dyA > dxA) {
    nx = sx;
    ny = sy + ys;
  } else {
    nx = sx + xs;
    ny = sy + ys;
  }
  // Validate move
  if (dxA === dyA) {
    // diagonal: check destination + both cardinal clipping tiles
    if (!bl[(nx << 6) | ny] && !bl[((sx + xs) << 6) | sy] && !bl[(sx << 6) | (sy + ys)]) return { x: nx, y: ny };
  } else {
    // cardinal: just check destination
    if (!bl[(nx << 6) | ny]) return { x: nx, y: ny };
  }
  // Blocked — BFS fallback
  return playerBFS(sx, sy, tx, ty, region);
}
