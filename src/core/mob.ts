import { MOB_DEFS } from '../data/mobs';
import type { Mob, MobType, ParsedSpawn, Player, Region, SimState, Tile } from '../types';
import { clearMobFromGrid, collidesWithEntities, collidesWithMobs, collisionMath, stampMobOnGrid } from './geometry';
import { mobHasLOS } from './los';

export function createMob(type: MobType, x: number, y: number, id: number): Mob {
  const d = MOB_DEFS[type];
  // Field order + presence here defines the Mob hidden class. Initialize every optional
  // field (infNum, parentBlobId, aggroTarget, _lastScanTick, _losCacheKey, _losCacheValue,
  // _gridCell) so all mobs share one shape and downstream writes don't trigger transitions.
  return {
    id,
    type,
    letter: d.letter,
    x,
    y,
    size: d.size,
    hp: d.hp,
    maxHp: d.hp,
    atkSpeed: d.atkSpeed,
    range: d.range,
    style: d.style,
    color: d.color,
    attackDelay: 0,
    stunned: 0,
    frozen: 0,
    dead: false,
    dying: -1,
    dyingStartTick: -1,
    corpseRemovalTick: undefined,
    pendingRemovalTick: undefined,
    revivedOnce: false,
    hasLOS: false,
    hadLOS: false,
    isBlob: d.isBlob ?? false,
    blobScanPrayer: null,
    hasDig: d.hasDig ?? false,
    digTimer: 0,
    digLocation: null,
    hasFlicker: d.hasFlicker ?? false,
    flickering: false,
    projDelay: new Int8Array(16),
    projDmg: new Int16Array(16),
    projCount: 0,
    noLOSTicks: 0,
    currentStyle: null,
    infNum: undefined,
    parentBlobId: undefined,
    aggroTarget: undefined,
    _lastScanTick: undefined,
    _losCacheKey: undefined,
    _losCacheValue: undefined,
    _gridCell: 0,
    _parentRef: null,
  };
}

export function spawnNibblers(
  mobs: Mob[],
  region: Region,
  createFn: (type: MobType, x: number, y: number, id: number) => Mob,
  idFn: () => number,
  grid?: Int16Array
): void {
  // Spawn 3 nibblers in the 3x3 box: gameX 19-21, gameY 25-27
  // (local coords 9:17 to 11:19 where SW=1:1)
  const positions: Tile[] = [];
  for (let x = 9; x <= 11; x++) for (let y = 12; y <= 14; y++) positions.push({ x, y });
  // Shuffle
  for (let i = positions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [positions[i], positions[j]] = [positions[j]!, positions[i]!];
  }
  let spawned = 0;
  for (const pos of positions) {
    if (spawned >= 3) break;
    if (!region.blocked[(pos.x << 6) | pos.y] && !collidesWithMobs(pos.x, pos.y, 1, mobs, null, false, grid)) {
      const nib = createFn('nibbler', pos.x, pos.y, idFn());
      nib.aggroTarget = 'player';
      nib.stunned = 0;
      nib._gridCell = mobs.length + 1;
      mobs.push(nib);
      if (grid !== undefined) stampMobOnGrid(grid, nib);
      spawned++;
    }
  }
}

export function startDig(mob: Mob, player: { x: number; y: number }, region: Region): void {
  mob.frozen = 6;
  mob.digTimer = 6;
  const s = mob.size;
  if (!collidesWithEntities(player.x - s + 1, player.y + s - 1, s, region.entities))
    mob.digLocation = { x: player.x - s + 1, y: player.y + s - 1 };
  else if (!collidesWithEntities(player.x, player.y, s, region.entities))
    mob.digLocation = { x: player.x, y: player.y };
  else if (!collidesWithEntities(player.x - s + 1, player.y, s, region.entities))
    mob.digLocation = { x: player.x - s + 1, y: player.y };
  else if (!collidesWithEntities(player.x, player.y + s - 1, s, region.entities))
    mob.digLocation = { x: player.x, y: player.y + s - 1 };
  else mob.digLocation = { x: player.x - 1, y: player.y + 1 };
}

export function markMobForProjectileRemoval(mob: Mob, tick: number, state?: SimState): void {
  if (mob.dead) return;
  mob.hp = 0;
  const wasUndef = mob.pendingRemovalTick === undefined;
  if (wasUndef || mob.pendingRemovalTick! > tick + 1) {
    mob.pendingRemovalTick = tick + 1;
    mob.dyingStartTick = tick;
    if (wasUndef && state) state.pendingDeathCount++;
  }
}

export function processCorpseExpiry(state: SimState, tick: number): void {
  if (state.corpsesPending === 0) return;
  const grid = state.mobGrid;
  const mobs = state.mobs;
  for (const mob of mobs) {
    if (mob.dead || mob.dying <= 0) continue;
    const remain = (mob.corpseRemovalTick ?? tick) - tick;
    if (remain <= 0) {
      clearMobFromGrid(grid, mob);
      mob.dead = true;
      mob.dying = 0;
      mob.corpseRemovalTick = undefined;
      mob.pendingRemovalTick = undefined;
      state.aliveCount--;
      state.corpsesPending--;
    } else {
      mob.dying = remain;
    }
  }
}

export function canMoveTiles(
  mob: Mob,
  xOff: number,
  yOff: number,
  region: Region,
  mobs: Mob[],
  grid?: Int16Array
): boolean {
  if (xOff === 0 && yOff === 0) return true;
  const s = mob.size;
  const dx = xOff;
  const dy = -yOff; // yOff=-1→south(+1), yOff=1→north(-1)
  const nx = mob.x + dx;
  const ny = mob.y + dy;
  const bl = region.blocked;
  const isNib = mob.type === 'nibbler';
  // Check new column tiles (if moving in x)
  if (dx === -1) {
    for (let i = 0; i < s; i++) {
      if (bl[(nx << 6) | (ny - i)]) return false;
      if (!isNib && collidesWithMobs(nx, ny - i, 1, mobs, mob, true, grid)) return false;
    }
  } else if (dx === 1) {
    const rx = nx + s - 1;
    for (let i = 0; i < s; i++) {
      if (bl[(rx << 6) | (ny - i)]) return false;
      if (!isNib && collidesWithMobs(rx, ny - i, 1, mobs, mob, true, grid)) return false;
    }
  }
  // Check new row tiles (if moving in y)
  if (dy === 1) {
    for (let i = 0; i < s; i++) {
      if (bl[((nx + i) << 6) | ny]) return false;
      if (!isNib && collidesWithMobs(nx + i, ny, 1, mobs, mob, true, grid)) return false;
    }
  } else if (dy === -1) {
    const by = ny - s + 1;
    for (let i = 0; i < s; i++) {
      if (bl[((nx + i) << 6) | by]) return false;
      if (!isNib && collidesWithMobs(nx + i, by, 1, mobs, mob, true, grid)) return false;
    }
  }
  return true;
}

// Mob movement step. Mirrors the original moveMob / hlMoveMob path (they were identical).
export function moveMobStep(mob: Mob, player: Player, region: Region, mobs: Mob[], grid?: Int16Array): void {
  if (mob.hasDig && mob.digTimer > 0) {
    mob.digTimer--;
    if (mob.digTimer === 0) {
      const loc = mob.digLocation;
      if (loc) {
        if (grid !== undefined) clearMobFromGrid(grid, mob);
        mob.x = loc.x;
        mob.y = loc.y;
        if (grid !== undefined) stampMobOnGrid(grid, mob);
      }
      mob.attackDelay = 6;
      mob.frozen = 2;
      mob.digLocation = null;
      if (player.aggro === mob) player.aggro = null;
    }
    return;
  }
  mob.hadLOS = mob.hasLOS;
  // Try the LOS micro-cache first — if neither the mob nor the player has moved since
  // the last write, raycast and friends produce the identical value. Reduces mobHasLOS
  // calls per mob from 2/tick (move + attack) to 1/tick when positions are stable.
  const losKey = (mob.x << 18) | ((mob.y & 0x3f) << 12) | ((player.x & 0x3f) << 6) | (player.y & 0x3f);
  if (mob._losCacheKey === losKey && mob._losCacheValue !== undefined) {
    mob.hasLOS = mob._losCacheValue;
  } else {
    mob.hasLOS = mobHasLOS(region, mob, player);
    mob._losCacheKey = losKey;
    mob._losCacheValue = mob.hasLOS;
  }
  if (mob.hasLOS) mob.noLOSTicks = 0;
  else mob.noLOSTicks = (mob.noLOSTicks ?? 0) + 1;
  if (mob.hasLOS || mob.frozen > 0) {
    // Mob will not move from here. Cache is already up to date from the lookup above.
    return;
  }
  if (mob.hasDig && !mob.hasLOS && !mob.digTimer) {
    if ((mob.attackDelay <= -38 && Math.random() < 0.1) || mob.attackDelay <= -50) {
      startDig(mob, player, region);
      return;
    }
  }
  let dx = mob.x + Math.sign(player.x - mob.x);
  let dy = mob.y + Math.sign(player.y - mob.y);
  if (collisionMath(mob.x, mob.y, mob.size, player.x, player.y, 1)) {
    if (Math.random() < 0.5) {
      dy = mob.y;
      dx = mob.x + (Math.random() < 0.5 ? 1 : -1);
    } else {
      dx = mob.x;
      dy = mob.y + (Math.random() < 0.5 ? 1 : -1);
    }
  } else if (collisionMath(dx, dy, mob.size, player.x, player.y, 1)) {
    dy = mob.y;
  }
  if (mob.attackDelay > mob.atkSpeed) return;
  const xOff = dx - mob.x;
  const yOff = mob.y - dy;
  // OSRS-style NPC movement: for diagonals, only the destination footprint must be open.
  // Requiring both cardinal components to be open delays large NPC diagonal turns by 1 tick.
  const both = canMoveTiles(mob, xOff, yOff, region, mobs, grid);
  let canMoveX = false;
  let canMoveY = false;
  if (!both) {
    if (xOff !== 0) canMoveX = canMoveTiles(mob, xOff, 0, region, mobs, grid);
    if (!canMoveX && yOff !== 0) canMoveY = canMoveTiles(mob, 0, yOff, region, mobs, grid);
  }
  if (both) {
    if (grid !== undefined) clearMobFromGrid(grid, mob);
    mob.x = dx;
    mob.y = dy;
    if (grid !== undefined) stampMobOnGrid(grid, mob);
  } else if (canMoveX) {
    if (grid !== undefined) clearMobFromGrid(grid, mob);
    mob.x = dx;
    if (grid !== undefined) stampMobOnGrid(grid, mob);
  } else if (canMoveY) {
    if (grid !== undefined) clearMobFromGrid(grid, mob);
    mob.y = dy;
    if (grid !== undefined) stampMobOnGrid(grid, mob);
  }
}

export function applySpawnList(
  spawns: ParsedSpawn[],
  hasIndexInfo: boolean,
  startIdCounter: number
): { mobs: Mob[]; idCounter: number } {
  const mobs: Mob[] = [];
  let id = startIdCounter;
  for (const spawn of spawns) {
    if (spawn.type === 'nothing') continue;
    const mob = createMob(spawn.type, spawn.x, spawn.y, id++);
    mob.aggroTarget = 'player';
    mob.infNum = spawn.infNum;
    mobs.push(mob);
  }
  // Sort by game index: higher infNum = lower game index = processed first
  if (hasIndexInfo) mobs.sort((a, b) => (b.infNum ?? 0) - (a.infNum ?? 0));
  // _gridCell is the 1-based index into this final array. Assign after the optional sort
  // so each mob's cell stays correct for grid stamping in initSimState.
  for (let i = 0; i < mobs.length; i++) mobs[i]!._gridCell = i + 1;
  return { mobs, idCounter: id };
}
