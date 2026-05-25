import { clearMobFromGrid, distToMob, MOB_GRID_SIZE, stampMobOnGrid } from '../core/geometry';
import { canUseSecondaryMelee, isUnderMob, isWithinMeleeRange, mobHasLOS, playerHasLOS } from '../core/los';
import {
  applySpawnList,
  createMob,
  markMobForProjectileRemoval,
  moveMobStep,
  processCorpseExpiry,
  spawnNibblers,
} from '../core/mob';
import { getClosestFaceTile, osrsWalkStep } from '../core/pathing';
import { createPlayer, setPlayerLastAttacker } from '../core/player';
import { monsterProjectileDelay, playerProjectileDelay } from '../core/projectiles';
import { createRegion, findRespawnLocation } from '../core/region';
import { isSpawnCodeError, parseSpawnCode } from '../core/spawnCode';
import { DEATH_ANIM_TICKS } from '../data/arena';
import type {
  AttackEvent,
  AttackStyle,
  DelayedBlobletSpawn,
  Loadout,
  Mob,
  PillarConfig,
  Player,
  PrayerType,
  Region,
  SimRecordMode,
  SimState,
  Tile,
} from '../types';

// Flat (dx, dy) pairs for the 8 blood-barrage AOE neighbors. Hoisted to module scope so
// the array is not re-created per player attack.
const AOE_OFFSETS = new Int8Array([-1, -1, -1, 0, -1, 1, 0, -1, 0, 1, 1, -1, 1, 0, 1, 1]);

export function initSimState(
  spawnCode: string,
  playerPos: Tile,
  pillarConfig: PillarConfig,
  loadout: Loadout,
  recordMode: SimRecordMode,
  cachedRegion?: Region
): SimState | null {
  const region = cachedRegion ?? createRegion(pillarConfig);
  const parsed = parseSpawnCode(spawnCode);
  if (isSpawnCodeError(parsed)) return null;
  const mobGrid = new Int16Array(MOB_GRID_SIZE);
  const { mobs, idCounter } = applySpawnList(parsed.spawns, parsed.hasIndexInfo, 0);
  // Stamp the initial mob footprints into the occupancy grid. Subsequent moves/deaths/
  // revives keep the grid in sync via clearMobFromGrid / stampMobOnGrid.
  for (const m of mobs) stampMobOnGrid(mobGrid, m);
  let nextId = idCounter;
  const allPillarsDead = !pillarConfig.S && !pillarConfig.W && !pillarConfig.N;
  if (allPillarsDead) {
    spawnNibblers(
      mobs,
      region,
      (t, x, y, id) => createMob(t, x, y, id),
      () => nextId++,
      mobGrid
    );
  }
  const player = createPlayer(playerPos.x, playerPos.y, loadout);
  const mobInitHP: Record<number, { hp: number; type: Mob['type'] }> = {};
  const mobMap = new Map<number, Mob>();
  for (const m of mobs) {
    mobInitHP[m.id] = { hp: m.hp, type: m.type };
    mobMap.set(m.id, m);
  }
  return {
    region,
    mobs,
    player,
    tick: 0,
    deadMobs: [],
    delayedBlobletSpawns: [],
    idCounter: nextId,
    loadout,
    recordMode,
    attacks: [],
    mobInitHP,
    mobMap,
    aliveCount: mobs.length,
    corpsesPending: 0,
    pendingDeathCount: 0,
    mobGrid,
    deadMobsHead: 0,
  };
}

export function onMobDeath(mob: Mob, state: SimState, _tick: number): void {
  const player = state.player;
  if (mob.isBlob) {
    state.delayedBlobletSpawns.push({ tick: _tick + 1, blob: mob });
  }
  if (!mob.type.startsWith('bloblet') && mob.type !== 'nibbler' && !mob.revivedOnce) {
    state.deadMobs.push(mob);
  }
  if (player.aggro === mob) player.aggro = null;
  if (player.lastAttacker === mob) player.lastAttacker = null;
}

export function processPendingMobDeaths(state: SimState, tick: number): void {
  if (state.pendingDeathCount === 0) return;
  for (const mob of state.mobs) {
    if (mob.dead || mob.dying > 0) continue;
    if (mob.pendingRemovalTick !== undefined && mob.pendingRemovalTick <= tick) {
      mob.pendingRemovalTick = undefined;
      mob.dying = DEATH_ANIM_TICKS;
      mob.corpseRemovalTick = tick + DEATH_ANIM_TICKS;
      state.pendingDeathCount--;
      state.corpsesPending++;
      onMobDeath(mob, state, tick);
    }
  }
}

export function spawnBlobletsFromBlob(blob: Mob, state: SimState): Mob[] {
  const mobs = state.mobs;
  const grid = state.mobGrid;
  const bm = createMob('blobletMage', blob.x + 2, blob.y - 2, state.idCounter++);
  const br = createMob('blobletRange', blob.x + 1, blob.y - 1, state.idCounter++);
  const bx = createMob('blobletMelee', blob.x, blob.y, state.idCounter++);
  for (const bl of [bm, br, bx]) {
    bl.aggroTarget = 'player';
    bl.stunned = 0;
    bl.frozen = 1;
    bl.attackDelay = 4;
    bl.parentBlobId = blob.id;
    bl._parentRef = blob;
    bl._gridCell = mobs.length + 1;
    mobs.push(bl);
    // Stamp the bloblet over the parent's still-dying footprint cell. When this bloblet
    // later moves or dies, clearMobFromGrid will restamp the parent on the now-empty
    // cell (so the parent's logical presence is preserved until its corpse expires).
    stampMobOnGrid(grid, bl);
    state.mobInitHP[bl.id] = { hp: bl.hp, type: bl.type };
    state.mobMap.set(bl.id, bl);
    state.aliveCount++;
  }
  return [bm, br, bx];
}

export function processDelayedBlobletSpawns(state: SimState, tick: number): Mob[] {
  const pending = state.delayedBlobletSpawns;
  if (pending.length === 0) return [];
  const spawned: Mob[] = [];
  const keep: DelayedBlobletSpawn[] = [];
  for (const item of pending) {
    if (item.tick <= tick) {
      const blobs = spawnBlobletsFromBlob(item.blob, state);
      spawned.push(...blobs);
    } else {
      keep.push(item);
    }
  }
  state.delayedBlobletSpawns = keep;
  return spawned;
}

// Mob fires attack: rolls accuracy + damage at fire time, stores event, queues projectile on player.
export function fireMobAttack(
  mob: Mob,
  player: Player,
  tick: number,
  state: SimState,
  overrideStyle?: AttackStyle | 'blob_attack',
  scanTickArg?: number
): AttackEvent {
  let style: AttackStyle;
  let isBlobAttack = false;
  if (overrideStyle === 'blob_attack') {
    style = mob.currentStyle ?? 'magic';
    isBlobAttack = true;
  } else {
    let s: AttackStyle = overrideStyle ?? mob.currentStyle ?? mob.style;
    if (s === 'blob') s = mob.currentStyle ?? 'magic';
    style = s;
  }
  let projectileStyle: AttackStyle = isBlobAttack ? (mob.currentStyle ?? 'magic') : style;
  if (canUseSecondaryMelee(mob, player) && Math.random() < 0.5) {
    projectileStyle = 'melee';
    style = 'melee';
    isBlobAttack = false;
  }
  const delay = monsterProjectileDelay(mob, projectileStyle, player);
  const edgeDist = distToMob(player.x, player.y, mob);
  const accRoll = Math.random();
  const dmgRoll = Math.random();
  // Headless mode only needs the delay; live mode still records the full object so
  // applyMobProjectilesLanding can match back to the corresponding AttackEvent later.
  if (state.recordMode === 'headless') {
    player.projDelays[player.projCount] = delay + 1;
    player.projCount++;
  } else {
    player.incomingProjectiles.push({
      delay: delay + 1,
      damage: 0,
      mobType: mob.type,
      mobId: mob.id,
      style: projectileStyle,
      fireTick: tick,
    });
  }
  setPlayerLastAttacker(player, mob);
  // All AttackEvent literals share one key set so V8 keeps them under a single hidden
  // class. Inapplicable fields are explicitly set to undefined rather than omitted.
  const event: AttackEvent = {
    tick,
    mobId: mob.id,
    mobType: mob.type,
    style: isBlobAttack ? null : style,
    isScan: false,
    scanTick: isBlobAttack ? (scanTickArg ?? tick - 3) : -1,
    accRoll,
    dmgRoll,
    distAtFire: edgeDist,
    hitTick: tick + delay,
    isPlayerAttack: undefined,
    playerDmg: undefined,
    targetMobId: undefined,
    targetMobType: undefined,
    isRevive: undefined,
    reviveHp: undefined,
  };
  state.attacks.push(event);
  return event;
}

// Blob scan. In live mode the prayer (if any) determines style (opposite of prayed); in headless
// mode it picks randomly and the calcSimDamage replay re-resolves with each candidate prayer.
export function blobScan(
  mob: Mob,
  tick: number,
  state: SimState,
  prayerForThisTick?: PrayerType
): { event: AttackEvent; style: AttackStyle } {
  mob.blobScanPrayer = 'scanned';
  mob.attackDelay = mob.atkSpeed;
  mob._lastScanTick = tick;
  let style: AttackStyle;
  if (prayerForThisTick === 'mage') style = 'range';
  else if (prayerForThisTick === 'range') style = 'magic';
  else style = Math.random() < 0.5 ? 'magic' : 'range';
  mob.currentStyle = style;
  const event: AttackEvent = {
    tick,
    mobId: mob.id,
    mobType: 'blob',
    style: null,
    isScan: true,
    scanTick: tick,
    accRoll: 0,
    dmgRoll: 0,
    distAtFire: undefined,
    hitTick: undefined,
    isPlayerAttack: undefined,
    playerDmg: undefined,
    targetMobId: undefined,
    targetMobType: undefined,
    isRevive: undefined,
    reviveHp: undefined,
  };
  state.attacks.push(event);
  return { event, style };
}

export interface ReviveResult {
  revived: Mob;
  reviveHp: number;
}

export function tryReviveMobFromMager(mob: Mob, state: SimState): ReviveResult | null {
  if (Math.random() >= 0.1 || state.deadMobsHead >= state.deadMobs.length) return null;
  // Pop via head index instead of Array.shift (O(N)).
  const toRes = state.deadMobs[state.deadMobsHead++]!;
  const wasDead = toRes.dead;
  const wasDying = toRes.dying;
  const hadPending = toRes.pendingRemovalTick !== undefined;
  toRes.revivedOnce = true;
  const reviveHp = Math.floor(toRes.maxHp / 2);
  toRes.hp = reviveHp;
  toRes.dead = false;
  toRes.dying = -1;
  toRes.pendingRemovalTick = undefined;
  toRes.corpseRemovalTick = undefined;
  toRes.attackDelay = toRes.atkSpeed + 1;
  toRes.stunned = 0;
  toRes.frozen = 0;
  // findRespawnLocation must see toRes as still occupying its OLD footprint — the
  // pre-refactor linear scan does that implicitly because toRes.x/y haven't been
  // updated yet. If toRes was fully dead, processCorpseExpiry already cleared its
  // grid stamp; restamp it temporarily so the grid lookup matches the linear scan.
  const grid = state.mobGrid;
  if (wasDead) stampMobOnGrid(grid, toRes);
  const loc = findRespawnLocation(toRes.size, state.region, state.mobs, grid);
  clearMobFromGrid(grid, toRes);
  toRes.x = loc.x;
  toRes.y = loc.y;
  toRes.aggroTarget = 'player';
  if (!state.mobs.includes(toRes)) {
    toRes._gridCell = state.mobs.length + 1;
    state.mobs.push(toRes);
  }
  stampMobOnGrid(grid, toRes);
  if (wasDead) state.aliveCount++;
  if (wasDying > 0) state.corpsesPending--;
  if (hadPending) state.pendingDeathCount--;
  mob.attackDelay = mob.atkSpeed * 2;
  const reviveEvent: AttackEvent = {
    tick: state.tick,
    mobId: toRes.id,
    mobType: toRes.type,
    style: null,
    isScan: false,
    scanTick: -1,
    accRoll: 0,
    dmgRoll: 0,
    distAtFire: undefined,
    hitTick: undefined,
    isPlayerAttack: undefined,
    playerDmg: undefined,
    targetMobId: undefined,
    targetMobType: undefined,
    isRevive: true,
    reviveHp,
  };
  state.attacks.push(reviveEvent);
  return { revived: toRes, reviveHp };
}

export type MobAttackOutcome =
  | { kind: 'idle' }
  | { kind: 'flicker'; flickering: boolean }
  | { kind: 'revive'; revived: Mob }
  | { kind: 'fire'; event: AttackEvent }
  | { kind: 'scan'; event: AttackEvent; style: AttackStyle };

// Mob attack step. Returns an outcome describing what happened so the UI layer can emit
// pretty events. The headless engine ignores the outcome.
export function mobAttackStep(
  mob: Mob,
  state: SimState,
  tick: number,
  getPrayerForTick?: (t: number) => PrayerType | undefined
): MobAttackOutcome {
  const player = state.player;
  const region = state.region;
  if (mob.dead || mob.dying > 0 || mob.stunned > 0) return { kind: 'idle' };
  mob.hadLOS = mob.hasLOS;
  if (mob.range === 1) {
    mob.hasLOS = isWithinMeleeRange(mob, player);
  } else {
    const key = (mob.x << 18) | ((mob.y & 0x3f) << 12) | ((player.x & 0x3f) << 6) | (player.y & 0x3f);
    if (mob._losCacheKey === key && mob._losCacheValue !== undefined) {
      mob.hasLOS = mob._losCacheValue;
    } else {
      mob.hasLOS = mobHasLOS(region, mob, player);
      mob._losCacheKey = key;
      mob._losCacheValue = mob.hasLOS;
    }
  }

  if (mob.hasFlicker) {
    const flickering = mob.attackDelay === 1 && mob.hasLOS;
    mob.flickering = flickering;
    if (!mob.hasLOS || mob.attackDelay > 0 || isUnderMob(mob, player)) return { kind: 'flicker', flickering };
    const revive = tryReviveMobFromMager(mob, state);
    if (revive) return { kind: 'revive', revived: revive.revived };
    const event = fireMobAttack(mob, player, tick, state);
    mob.attackDelay = mob.atkSpeed;
    return { kind: 'fire', event };
  }
  if (mob.isBlob) {
    if (!mob.hasLOS && !mob.blobScanPrayer) return { kind: 'idle' };
    if (mob.hasLOS && (!mob.hadLOS || (!mob.blobScanPrayer && mob.attackDelay <= 0))) {
      const prayer = getPrayerForTick?.(tick);
      const scan = blobScan(mob, tick, state, prayer);
      return { kind: 'scan', event: scan.event, style: scan.style };
    }
    if (mob.blobScanPrayer && mob.attackDelay <= 0) {
      const scanTick = mob._lastScanTick ?? tick - 3;
      const event = fireMobAttack(mob, player, tick, state, 'blob_attack', scanTick);
      mob.blobScanPrayer = null;
      mob.attackDelay = mob.atkSpeed;
      return { kind: 'fire', event };
    }
    return { kind: 'idle' };
  }
  if (!mob.hasLOS || mob.attackDelay > 0 || isUnderMob(mob, player)) return { kind: 'idle' };
  const event = fireMobAttack(mob, player, tick, state, mob.style);
  mob.attackDelay = mob.atkSpeed;
  return { kind: 'fire', event };
}

// Player movement step toward aggro target (running: 2 walk steps per tick).
export function movePlayerStep(state: SimState): void {
  const { player, region } = state;
  if (!player.aggro || player.aggro.dead || player.aggro.dying > 0 || player.aggro.pendingRemovalTick !== undefined)
    return;
  const target = player.aggro;
  if (
    distToMob(player.x, player.y, target) <= player.range &&
    playerHasLOS(region, player.x, player.y, target, player.range)
  )
    return;
  const dest = getClosestFaceTile(target, player.x, player.y, region);
  if (!dest) return;
  const step1 = osrsWalkStep(player.x, player.y, dest.x, dest.y, region);
  if (!step1) return;
  player.x = step1.x;
  player.y = step1.y;
  if (player.x === dest.x && player.y === dest.y) return;
  const step2 = osrsWalkStep(player.x, player.y, dest.x, dest.y, region);
  if (step2) {
    player.x = step2.x;
    player.y = step2.y;
  }
}

export interface PlayerAttackOutcome {
  fired: boolean;
  events: AttackEvent[];
}

// Player attack step: rolls accuracy + damage at fire time. Damage is applied when the
// projectile lands (see processMobIncomingProjectiles). Blood barrage AOE hits up to 8
// adjacent mobs.
export function playerAttackStep(state: SimState, tick: number): PlayerAttackOutcome {
  const { player, region, loadout, mobs } = state;
  if (player.aggro && (player.aggro.dead || (player.aggro.dying > 0 && tick > player.aggro.dyingStartTick)))
    player.aggro = null;
  if (!player.aggro || player.attackDelay > 0 || player.aggro.pendingRemovalTick !== undefined)
    return { fired: false, events: [] };
  if (!playerHasLOS(region, player.x, player.y, player.aggro, loadout.range)) return { fired: false, events: [] };
  const target = player.aggro;
  const events: AttackEvent[] = [];
  const delay = playerProjectileDelay(loadout, player.x, player.y, target);
  const accArr = loadout.playerAcc[target.type];
  const acc = player.lastHit ? accArr[0] : accArr[1];
  const hit = Math.random() < acc;
  let dmg = 0;
  if (hit) {
    dmg = Math.floor(Math.random() * (loadout.maxHit + 1));
    player.lastHit = true;
  } else {
    player.lastHit = false;
  }
  target.projDelay[target.projCount] = delay;
  target.projDmg[target.projCount] = dmg;
  target.projCount++;
  const primaryEvent: AttackEvent = {
    tick,
    mobId: target.id,
    mobType: target.type,
    style: null,
    isScan: false,
    scanTick: -1,
    accRoll: 0,
    dmgRoll: 0,
    distAtFire: undefined,
    hitTick: tick + delay,
    isPlayerAttack: true,
    playerDmg: dmg,
    targetMobId: target.id,
    targetMobType: target.type,
    isRevive: undefined,
    reviveHp: undefined,
  };
  state.attacks.push(primaryEvent);
  events.push(primaryEvent);
  if (loadout.isBloodBarrage) {
    if (dmg > 0 && player.hp < player.maxHp) {
      player.hp = Math.min(player.maxHp, player.hp + Math.floor(dmg * 0.25));
    }
    let hitCount = 1;
    for (let oi = 0; oi < 16; oi += 2) {
      if (hitCount >= 9) break;
      const ax = target.x + AOE_OFFSETS[oi]!;
      const ay = target.y + AOE_OFFSETS[oi + 1]!;
      for (const m of mobs) {
        if (m.dead || m.dying > 0 || m.pendingRemovalTick !== undefined || m === target) continue;
        if (m.x === ax && m.y === ay) {
          hitCount++;
          const sAccArr = loadout.playerAcc[m.type];
          const sAcc = player.lastHit ? sAccArr[0] : sAccArr[1];
          const sHit = Math.random() < sAcc;
          const sDmg = sHit ? Math.floor(Math.random() * (loadout.maxHit + 1)) : 0;
          const sDelay = playerProjectileDelay(loadout, player.x, player.y, m);
          m.projDelay[m.projCount] = sDelay;
          m.projDmg[m.projCount] = sDmg;
          m.projCount++;
          if (sDmg > 0 && player.hp < player.maxHp) {
            player.hp = Math.min(player.maxHp, player.hp + Math.floor(sDmg * 0.25));
          }
          const splashEvent: AttackEvent = {
            tick,
            mobId: m.id,
            mobType: m.type,
            style: null,
            isScan: false,
            scanTick: -1,
            accRoll: 0,
            dmgRoll: 0,
            distAtFire: undefined,
            hitTick: tick + sDelay,
            isPlayerAttack: true,
            playerDmg: sDmg,
            targetMobId: m.id,
            targetMobType: m.type,
            isRevive: undefined,
            reviveHp: undefined,
          };
          state.attacks.push(splashEvent);
          events.push(splashEvent);
          break;
        }
      }
    }
    if (dmg > 0) player.lastBarrageTarget = { x: target.x, y: target.y, tick };
  }
  player.attackDelay = loadout.atkSpeed;
  return { fired: true, events };
}

// Apply player attack projectiles landing on mobs. Mirrors the original processIncomingProjectiles.
// SoA typed-array form: walk projDelay/projDmg up to projCount, decrement delays, apply landed
// damage, compact in place to drop landed entries.
export function processMobIncomingProjectiles(state: SimState, tick: number): void {
  for (const mob of state.mobs) {
    if (mob.dead || mob.dying > 0) continue;
    const n = mob.projCount;
    if (n === 0) continue;
    const delays = mob.projDelay;
    const dmgs = mob.projDmg;
    let w = 0;
    for (let r = 0; r < n; r++) {
      const d = delays[r]! - 1;
      if (d <= 0) {
        if (mob.pendingRemovalTick === undefined) {
          mob.hp -= dmgs[r]!;
          if (mob.hp <= 0) markMobForProjectileRemoval(mob, tick, state);
        }
      } else {
        delays[w] = d;
        dmgs[w] = dmgs[r]!;
        w++;
      }
    }
    mob.projCount = w;
  }
}

// Process mob projectiles landing on player. Headless mode only needs to know whether
// anything arrived (auto-retaliate gate). Walk the packed Int8Array, decrement delays,
// compact in place to drop landed entries.
export function drainPlayerIncomingProjectiles(state: SimState): boolean {
  const player = state.player;
  const n = player.projCount;
  if (n === 0) return false;
  const delays = player.projDelays;
  let w = 0;
  let anyArrived = false;
  for (let r = 0; r < n; r++) {
    const d = delays[r]! - 1;
    if (d <= 0) anyArrived = true;
    else {
      delays[w] = d;
      w++;
    }
  }
  player.projCount = w;
  return anyArrived;
}

// Apply auto-retaliate after projectiles arrive.
export function applyAutoRetaliate(state: SimState, tick: number, anyArrived: boolean): void {
  if (!state.player.autoRetaliate || !anyArrived) return;
  const a = state.player.aggro;
  if (!a || a.dead || (a.dying > 0 && tick > a.dyingStartTick)) {
    const target = state.player.lastAttacker;
    if (target && !target.dead && target.dying === -1 && target.pendingRemovalTick === undefined) {
      state.player.aggro = target;
      const fd = Math.floor(state.loadout.atkSpeed / 2) + 1;
      if (state.player.attackDelay < fd) state.player.attackDelay = fd;
    }
  }
}

// Headless tick: rolls all randomness at fire time, stores in state.attacks, drains projectile
// queues without applying mob-attack damage to player (calcSimDamage handles it post-hoc).
export function headlessTick(state: SimState): void {
  state.tick++;
  const tick = state.tick;
  processCorpseExpiry(state, tick);
  processPendingMobDeaths(state, tick);
  processDelayedBlobletSpawns(state, tick);
  const mobs = state.mobs;
  const player = state.player;
  const region = state.region;
  const grid = state.mobGrid;
  for (let i = 0; i < mobs.length; i++) {
    const mob = mobs[i]!;
    if (mob.dead || mob.dying > 0) continue;
    if (mob.stunned > 0) {
      mob.stunned--;
      continue;
    }
    if (mob.frozen > 0) {
      mob.frozen--;
      continue;
    }
    moveMobStep(mob, player, region, mobs, grid);
  }
  // Fused attack + incoming-projectile pass. Original code ran two sequential loops
  // over state.mobs (attack, then process projectiles). Both pass through the same
  // live-mob filter, so we merge to halve the iteration cost. Stunned mobs still
  // process projectiles but skip the attack step (matches the original filters).
  for (let i = 0; i < mobs.length; i++) {
    const mob = mobs[i]!;
    if (mob.dead || mob.dying > 0) continue;
    if (mob.stunned === 0) {
      mob.attackDelay--;
      mobAttackStep(mob, state, tick);
    }
    const n = mob.projCount;
    if (n !== 0) {
      const delays = mob.projDelay;
      const dmgs = mob.projDmg;
      let w = 0;
      for (let r = 0; r < n; r++) {
        const d = delays[r]! - 1;
        if (d <= 0) {
          if (mob.pendingRemovalTick === undefined) {
            mob.hp -= dmgs[r]!;
            if (mob.hp <= 0) markMobForProjectileRemoval(mob, tick, state);
          }
        } else {
          delays[w] = d;
          dmgs[w] = dmgs[r]!;
          w++;
        }
      }
      mob.projCount = w;
    }
  }
  const anyArrived = drainPlayerIncomingProjectiles(state);
  applyAutoRetaliate(state, tick, anyArrived);
  player.attackDelay--;
  movePlayerStep(state);
  playerAttackStep(state, tick);
}
