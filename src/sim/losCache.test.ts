import { beforeEach, describe, expect, it } from 'vitest';
import { createMob } from '../core/mob';
import { createPlayer } from '../core/player';
import { createRegion } from '../core/region';
import { LOADOUTS } from '../data/loadouts';
import type { Mob, Player, SimState } from '../types';
import { mobAttackStep } from './engine';

// Deterministic RNG for any tick logic that consults Math.random.
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

const PILLARS = { S: true, W: true, N: true };
const REGION = createRegion(PILLARS);

function expectedKey(mob: Mob, player: Player): number {
  return (mob.x << 18) | ((mob.y & 0x3f) << 12) | ((player.x & 0x3f) << 6) | (player.y & 0x3f);
}

function makeState(mob: Mob, player: Player): SimState {
  return {
    region: REGION,
    mobs: [mob],
    player,
    tick: 0,
    deadMobs: [],
    delayedBlobletSpawns: [],
    idCounter: mob.id + 1,
    loadout: LOADOUTS.magetank,
    recordMode: 'headless',
    attacks: [],
    mobInitHP: { [mob.id]: { hp: mob.hp, type: mob.type } },
    mobMap: new Map([[mob.id, mob]]),
    aliveCount: 1,
    corpsesPending: 0,
    pendingDeathCount: 0,
    mobGrid: new Int16Array(4096),
    deadMobsHead: 0,
  };
}

describe('mobAttackStep — LOS cache (mob._losCacheKey / _losCacheValue)', () => {
  beforeEach(() => resetSeed());

  it('caches the LOS result on first call with the (mob, player) position key', () => {
    const mager = createMob('mager', 2, 6, 1);
    mager.aggroTarget = 'player';
    const player = createPlayer(15, 12, LOADOUTS.magetank);
    const state = makeState(mager, player);

    expect(mager._losCacheKey).toBeUndefined();
    expect(mager._losCacheValue).toBeUndefined();

    mobAttackStep(mager, state, 1);

    expect(mager._losCacheKey).toBe(expectedKey(mager, player));
    expect(mager._losCacheValue).toBe(mager.hasLOS);
  });

  it('reads the cached value on a repeat call with identical positions', () => {
    const mager = createMob('mager', 2, 6, 1);
    mager.aggroTarget = 'player';
    const player = createPlayer(15, 12, LOADOUTS.magetank);
    const state = makeState(mager, player);

    mobAttackStep(mager, state, 1);
    const firstKey = mager._losCacheKey;
    const firstValue = mager._losCacheValue;

    // Poison the cache with the OPPOSITE value. If the cache is read, hasLOS picks up the
    // poisoned value; if it falls through to mobHasLOS, hasLOS reflects ground truth.
    mager._losCacheValue = !firstValue;

    mobAttackStep(mager, state, 2);

    // Cache hit: hasLOS reflects the poisoned (wrong) value, proving the cache was read.
    expect(mager.hasLOS).toBe(!firstValue);
    // Key didn't move (positions unchanged).
    expect(mager._losCacheKey).toBe(firstKey);
  });

  it('recomputes when the mob position changes (cache key differs)', () => {
    const mager = createMob('mager', 2, 6, 1);
    mager.aggroTarget = 'player';
    const player = createPlayer(15, 12, LOADOUTS.magetank);
    const state = makeState(mager, player);

    mobAttackStep(mager, state, 1);
    // Poison cache to detect whether we fall through to recompute.
    const poisoned = !mager._losCacheValue;
    mager._losCacheValue = poisoned;

    // Move the mob — the next call must rebuild the cache from the new position.
    mager.x = 3;
    mobAttackStep(mager, state, 2);

    expect(mager._losCacheKey).toBe(expectedKey(mager, player));
    // The recomputed value is ground truth, NOT the poisoned cache value.
    expect(mager._losCacheValue).toBe(mager.hasLOS);
  });

  it('recomputes when the player position changes', () => {
    const mager = createMob('mager', 2, 6, 1);
    mager.aggroTarget = 'player';
    const player = createPlayer(15, 12, LOADOUTS.magetank);
    const state = makeState(mager, player);

    mobAttackStep(mager, state, 1);
    const poisoned = !mager._losCacheValue;
    mager._losCacheValue = poisoned;

    // Player walks — cache key changes, recompute.
    player.x = 16;
    mobAttackStep(mager, state, 2);

    expect(mager._losCacheKey).toBe(expectedKey(mager, player));
    expect(mager._losCacheValue).toBe(mager.hasLOS);
  });

  it('does not use the cache path for range=1 mobs (meleer/nibbler)', () => {
    // range=1 takes the isWithinMeleeRange branch in mobAttackStep, which never touches
    // _losCacheKey. (Note: bat is range=4 and DOES use the cache path.)
    const nibbler = createMob('nibbler', 5, 10, 1);
    nibbler.aggroTarget = 'player';
    nibbler.attackDelay = 5; // prevent attempting fire
    const player = createPlayer(20, 20, LOADOUTS.magetank);
    const state = makeState(nibbler, player);

    mobAttackStep(nibbler, state, 1);

    expect(nibbler._losCacheKey).toBeUndefined();
    expect(nibbler._losCacheValue).toBeUndefined();
  });
});
