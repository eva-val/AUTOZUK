import { beforeEach, describe, expect, it } from 'vitest';
import { LOADOUTS } from '../data/loadouts';
import { MOB_DEFS } from '../data/mobs';
import type { Mob, MobType, Region, SimState } from '../types';
import {
  canMoveTiles,
  createMob,
  markMobForProjectileRemoval,
  processCorpseExpiry,
  spawnNibblers,
  startDig,
} from './mob';
import { createRegion } from './region';

const ALL_PILLARS = { S: true, W: true, N: true };
const REGION = createRegion(ALL_PILLARS);

// Deterministic RNG for any test touching Math.random (spawnNibblers shuffle, startDig fallback).
let _seed = 0xdeadbeef >>> 0;
function rand(): number {
  _seed = (_seed + 0x6d2b79f5) >>> 0;
  let t = _seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
Math.random = rand;
function resetSeed(s = 0xdeadbeef): void {
  _seed = s >>> 0;
}

describe('createMob', () => {
  it.each<MobType>([
    'mager',
    'ranger',
    'meleer',
    'blob',
    'bat',
    'nibbler',
    'blobletMage',
    'blobletRange',
    'blobletMelee',
  ])('populates %s from MOB_DEFS', (type) => {
    const d = MOB_DEFS[type];
    const m = createMob(type, 5, 6, 42);
    expect(m.id).toBe(42);
    expect(m.type).toBe(type);
    expect(m.x).toBe(5);
    expect(m.y).toBe(6);
    expect(m.letter).toBe(d.letter);
    expect(m.size).toBe(d.size);
    expect(m.hp).toBe(d.hp);
    expect(m.maxHp).toBe(d.hp);
    expect(m.atkSpeed).toBe(d.atkSpeed);
    expect(m.range).toBe(d.range);
    expect(m.style).toBe(d.style);
    expect(m.dead).toBe(false);
    expect(m.dying).toBe(-1);
    expect(m.incomingProjectiles).toEqual([]);
  });

  it('sets isBlob only for blob', () => {
    expect(createMob('blob', 0, 0, 0).isBlob).toBe(true);
    expect(createMob('mager', 0, 0, 0).isBlob).toBe(false);
    expect(createMob('bat', 0, 0, 0).isBlob).toBe(false);
  });

  it('sets hasDig only for meleer', () => {
    expect(createMob('meleer', 0, 0, 0).hasDig).toBe(true);
    expect(createMob('mager', 0, 0, 0).hasDig).toBe(false);
  });

  it('sets hasFlicker only for mager', () => {
    expect(createMob('mager', 0, 0, 0).hasFlicker).toBe(true);
    expect(createMob('ranger', 0, 0, 0).hasFlicker).toBe(false);
  });
});

describe('spawnNibblers', () => {
  beforeEach(() => resetSeed());

  it('spawns 3 nibblers in the 9..11 × 12..14 box when empty', () => {
    const mobs: Mob[] = [];
    let id = 100;
    spawnNibblers(mobs, REGION, createMob, () => id++);
    expect(mobs).toHaveLength(3);
    for (const n of mobs) {
      expect(n.type).toBe('nibbler');
      expect(n.aggroTarget).toBe('player');
      expect(n.stunned).toBe(0);
      expect(n.x).toBeGreaterThanOrEqual(9);
      expect(n.x).toBeLessThanOrEqual(11);
      expect(n.y).toBeGreaterThanOrEqual(12);
      expect(n.y).toBeLessThanOrEqual(14);
    }
    // All three positions distinct.
    const keys = mobs.map((m) => `${m.x},${m.y}`);
    expect(new Set(keys).size).toBe(3);
  });

  it('skips positions already occupied by an existing mob', () => {
    // Pre-place a bat at (10, 13) — one of the candidate slots.
    const blocker = createMob('bat', 10, 13, 1);
    const mobs: Mob[] = [blocker];
    let id = 100;
    spawnNibblers(mobs, REGION, createMob, () => id++);
    const nibs = mobs.filter((m) => m.type === 'nibbler');
    expect(nibs).toHaveLength(3);
    for (const n of nibs) {
      // Bat at (10,13) is size 2 → covers x:10..11, y:12..13. Nibblers must avoid the
      // overlapping tiles. Any nibbler placed clear of the bat footprint is acceptable.
      const overlapsBat = n.x >= 10 && n.x <= 11 && n.y >= 12 && n.y <= 13;
      expect(overlapsBat).toBe(false);
    }
  });

  it('assigns IDs from the supplied counter, in order', () => {
    const mobs: Mob[] = [];
    let id = 200;
    spawnNibblers(mobs, REGION, createMob, () => id++);
    const ids = mobs.map((m) => m.id).sort((a, b) => a - b);
    expect(ids).toEqual([200, 201, 202]);
  });
});

describe('startDig', () => {
  it('freezes mob for 6 ticks and sets a valid dig location near the player', () => {
    const meleer = createMob('meleer', 10, 10, 1);
    const player = { x: 14, y: 14 };
    startDig(meleer, player, REGION);
    expect(meleer.frozen).toBe(6);
    expect(meleer.digTimer).toBe(6);
    expect(meleer.digLocation).not.toBeNull();
    // dig location is one of the four player-adjacent footprint positions (size 4 meleer).
    const dl = meleer.digLocation!;
    expect(Math.abs(dl.x - player.x)).toBeLessThanOrEqual(meleer.size);
    expect(Math.abs(dl.y - player.y)).toBeLessThanOrEqual(meleer.size);
  });
});

function makeState(): SimState {
  // Minimal SimState shim — only the fields the functions touch.
  return {
    region: REGION,
    mobs: [],
    player: {} as never,
    tick: 0,
    deadMobs: [],
    delayedBlobletSpawns: [],
    idCounter: 0,
    loadout: LOADOUTS.magetank,
    recordMode: 'headless',
    attacks: [],
    mobInitHP: {},
    mobMap: new Map(),
    aliveCount: 0,
    corpsesPending: 0,
    pendingDeathCount: 0,
  };
}

describe('markMobForProjectileRemoval', () => {
  it('sets pendingRemovalTick and increments state.pendingDeathCount on first mark', () => {
    const state = makeState();
    const mob = createMob('bat', 5, 5, 1);
    state.mobs.push(mob);
    state.aliveCount = 1;

    markMobForProjectileRemoval(mob, 10, state);

    expect(mob.hp).toBe(0);
    expect(mob.pendingRemovalTick).toBe(11);
    expect(mob.dyingStartTick).toBe(10);
    expect(state.pendingDeathCount).toBe(1);
  });

  it('does not double-increment when already marked', () => {
    const state = makeState();
    const mob = createMob('bat', 5, 5, 1);
    markMobForProjectileRemoval(mob, 10, state);
    expect(state.pendingDeathCount).toBe(1);

    markMobForProjectileRemoval(mob, 11, state);

    // Counter stays at 1; pendingRemovalTick is only lowered if the new tick is earlier.
    expect(state.pendingDeathCount).toBe(1);
    expect(mob.pendingRemovalTick).toBe(11); // Math.min path: 11 < 11+1=12, stays 11
  });

  it('is a no-op on dead mobs', () => {
    const state = makeState();
    const mob = createMob('bat', 5, 5, 1);
    mob.dead = true;
    markMobForProjectileRemoval(mob, 10, state);
    expect(mob.hp).toBe(mob.maxHp); // hp not zeroed
    expect(mob.pendingRemovalTick).toBeUndefined();
    expect(state.pendingDeathCount).toBe(0);
  });

  it('omits counter update when called without state (legacy signature)', () => {
    const mob = createMob('bat', 5, 5, 1);
    markMobForProjectileRemoval(mob, 10);
    expect(mob.pendingRemovalTick).toBe(11);
    expect(mob.dyingStartTick).toBe(10);
  });
});

describe('processCorpseExpiry', () => {
  it('decrements dying counter each tick and finalizes death at corpseRemovalTick', () => {
    const state = makeState();
    const mob = createMob('bat', 5, 5, 1);
    mob.dying = 3;
    mob.corpseRemovalTick = 14; // expires at tick 14
    state.mobs.push(mob);
    state.aliveCount = 1;
    state.corpsesPending = 1;

    processCorpseExpiry(state, 12);
    expect(mob.dying).toBe(2);
    expect(state.aliveCount).toBe(1);

    processCorpseExpiry(state, 13);
    expect(mob.dying).toBe(1);

    processCorpseExpiry(state, 14);
    expect(mob.dead).toBe(true);
    expect(mob.dying).toBe(0);
    expect(state.aliveCount).toBe(0);
    expect(state.corpsesPending).toBe(0);
  });

  it('early-exits when corpsesPending is 0 (perf guard)', () => {
    // Mutate a mob to "dying" but leave corpsesPending at 0 — function should skip the
    // loop entirely, leaving mob state untouched. This locks in the new perf guard.
    const state = makeState();
    const mob = createMob('bat', 5, 5, 1);
    mob.dying = 3;
    mob.corpseRemovalTick = 10;
    state.mobs.push(mob);
    state.corpsesPending = 0;

    processCorpseExpiry(state, 10);

    expect(mob.dying).toBe(3); // untouched
    expect(mob.dead).toBe(false);
  });
});

function emptyRegion(): Region {
  // Region with arena walls only, no pillars — gives a clean field for canMoveTiles tests.
  return createRegion({ S: false, W: false, N: false });
}

describe('canMoveTiles', () => {
  const region = emptyRegion();

  it('returns true for the no-op (0, 0)', () => {
    const mob = createMob('bat', 10, 10, 1);
    expect(canMoveTiles(mob, 0, 0, region, [])).toBe(true);
  });

  it('returns false when moving into a wall', () => {
    // Arena bounds: x in [1, 29]. A bat (size 2) at x=2 cannot step west (xOff=-1) — its
    // leftmost column would land on x=1 which is fine; another step west (x=1 → x=0) hits
    // the arena wall.
    const mob = createMob('bat', 1, 10, 1);
    expect(canMoveTiles(mob, -1, 0, region, [])).toBe(false);
  });

  it('returns false when moving into another mob', () => {
    const moving = createMob('mager', 5, 10, 1);
    const blocking = createMob('ranger', 9, 10, 2); // mager size 4: footprint x:5..8, ranger at x:9..11
    expect(canMoveTiles(moving, 1, 0, region, [moving, blocking])).toBe(false);
  });

  it('nibblers ignore mob collisions (can walk through others)', () => {
    const nibbler = createMob('nibbler', 5, 10, 1);
    const blocker = createMob('bat', 6, 10, 2);
    // bat at (6,10) size 2 covers x:6..7 y:9..10. Nibbler moving east to x=6 would collide
    // with a normal mob but should pass for nibblers (skipNibblers=true in collision).
    expect(canMoveTiles(nibbler, 1, 0, region, [nibbler, blocker])).toBe(true);
  });

  it('returns true for an unblocked cardinal move', () => {
    const mob = createMob('mager', 5, 10, 1);
    expect(canMoveTiles(mob, 1, 0, region, [mob])).toBe(true);
    expect(canMoveTiles(mob, 0, 1, region, [mob])).toBe(true);
  });
});
