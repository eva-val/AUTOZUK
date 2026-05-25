import { describe, expect, it } from 'vitest';
import type { Mob, Player } from '../types';
import {
  canUseSecondaryMelee,
  hasLineOfSight,
  isUnderMob,
  isWithinMeleeRange,
  isWithinSecondaryMeleeRange,
  mobHasLOS,
  playerHasLOS,
  raycast,
} from './los';
import { createRegion } from './region';

const openRegion = createRegion({ S: false, W: false, N: false });

function mkMob(x: number, y: number, size = 1, overrides: Partial<Mob> = {}): Mob {
  return {
    id: 1,
    type: 'meleer',
    letter: 'X',
    x,
    y,
    size,
    hp: 75,
    maxHp: 75,
    atkSpeed: 4,
    range: 1,
    style: 'melee',
    color: '#000',
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
    isBlob: false,
    blobScanPrayer: null,
    hasDig: false,
    digTimer: 0,
    digLocation: null,
    hasFlicker: false,
    flickering: false,
    projDelay: new Int8Array(16),
    projDmg: new Int16Array(16),
    projCount: 0,
    noLOSTicks: 0,
    currentStyle: null,
    _gridCell: 0,
    _parentRef: null,
    ...overrides,
  };
}

const mkPlayer = (x: number, y: number): Player => ({
  x,
  y,
  size: 1,
  hp: 99,
  maxHp: 99,
  aggro: null,
  attackDelay: 0,
  range: 6,
  atkSpeed: 5,
  projDelays: new Int8Array(32),
  projCount: 0,
  incomingProjectiles: [],
  autoRetaliate: true,
  lastHit: false,
  recoilQueue: [],
  echoBootsCooldown: 0,
  lastBarrageTarget: null,
  lastAttacker: null,
});

describe('isWithinMeleeRange', () => {
  it('accepts SW-tile-adjacent 1x1', () => {
    const m = mkMob(10, 10, 1);
    expect(isWithinMeleeRange(m, { x: 9, y: 10 })).toBe(true);
    expect(isWithinMeleeRange(m, { x: 11, y: 10 })).toBe(true);
    expect(isWithinMeleeRange(m, { x: 10, y: 9 })).toBe(true);
    expect(isWithinMeleeRange(m, { x: 10, y: 11 })).toBe(true);
  });
  it('rejects diagonals for 1x1 mob', () => {
    const m = mkMob(10, 10, 1);
    expect(isWithinMeleeRange(m, { x: 9, y: 9 })).toBe(false);
    expect(isWithinMeleeRange(m, { x: 11, y: 11 })).toBe(false);
  });
  it('handles size>1 footprints (faces only, no diagonals)', () => {
    const m = mkMob(10, 12, 3); // x:10..12, y:10..12
    // South face row y=13
    expect(isWithinMeleeRange(m, { x: 10, y: 13 })).toBe(true);
    expect(isWithinMeleeRange(m, { x: 12, y: 13 })).toBe(true);
    // North face row y=9
    expect(isWithinMeleeRange(m, { x: 11, y: 9 })).toBe(true);
    // West face column x=9
    expect(isWithinMeleeRange(m, { x: 9, y: 11 })).toBe(true);
    // East face column x=13
    expect(isWithinMeleeRange(m, { x: 13, y: 11 })).toBe(true);
    // Corner diagonals rejected
    expect(isWithinMeleeRange(m, { x: 9, y: 9 })).toBe(false);
    expect(isWithinMeleeRange(m, { x: 13, y: 13 })).toBe(false);
  });
});

describe('isWithinSecondaryMeleeRange', () => {
  it('includes diagonals', () => {
    const m = mkMob(10, 10, 1);
    expect(isWithinSecondaryMeleeRange(m, { x: 9, y: 9 })).toBe(true);
    expect(isWithinSecondaryMeleeRange(m, { x: 11, y: 11 })).toBe(true);
  });
  it('rejects 2+ tiles away', () => {
    const m = mkMob(10, 10, 1);
    expect(isWithinSecondaryMeleeRange(m, { x: 12, y: 10 })).toBe(false);
  });
});

describe('canUseSecondaryMelee', () => {
  it('is true for ranger/mager/blob within 1 tile of the footprint (incl. diagonals)', () => {
    // Ranger at (10,10) size 3 occupies x:10..12, y:8..10. Adjacent tiles (incl. corners):
    // x in [9,13], y in [7,11] minus the footprint itself.
    const ranger = mkMob(10, 10, 3, { type: 'ranger', range: 15 });
    expect(canUseSecondaryMelee(ranger, mkPlayer(13, 10))).toBe(true); // east face
    expect(canUseSecondaryMelee(ranger, mkPlayer(13, 11))).toBe(true); // SE corner diagonal
    expect(canUseSecondaryMelee(ranger, mkPlayer(9, 7))).toBe(true); // NW corner diagonal
  });
  it('is false for non-applicable mob types', () => {
    const meleer = mkMob(10, 10, 4, { type: 'meleer', range: 1 });
    expect(canUseSecondaryMelee(meleer, mkPlayer(11, 10))).toBe(false);
  });
});

describe('isUnderMob', () => {
  it('detects player inside mob footprint', () => {
    const m = mkMob(10, 12, 3);
    expect(isUnderMob(m, mkPlayer(11, 11))).toBe(true);
    expect(isUnderMob(m, mkPlayer(15, 11))).toBe(false);
  });
});

describe('raycast', () => {
  it('open arena: every shot succeeds within range', () => {
    expect(raycast(openRegion, 5, 5, 10, 10)).toBe(true);
    expect(raycast(openRegion, 10, 10, 5, 5)).toBe(true);
  });
  it('blocked by arena wall: the +1 padding on (0,*) is opaque', () => {
    // Walls live at x=0, x=30, y=0, y=31 (per createRegion).
    expect(raycast(openRegion, 1, 5, -1, 5)).toBe(false);
  });
});

describe('hasLineOfSight / mobHasLOS / playerHasLOS', () => {
  it('NPC LOS over open ground', () => {
    const m = mkMob(10, 10, 3, { range: 15 });
    expect(mobHasLOS(openRegion, m, mkPlayer(20, 10))).toBe(true);
  });
  it('player LOS to closest-tile of mob within range', () => {
    // Mob 3x3 at (10,10): occupies x:10..12, y:8..10. Closest tile to (15,10) is (12,10).
    // chebyshev = 3, within player range 6.
    const m = mkMob(10, 10, 3, { range: 15 });
    expect(playerHasLOS(openRegion, 15, 10, m, 6)).toBe(true);
    // Out of range
    expect(playerHasLOS(openRegion, 20, 10, m, 6)).toBe(false);
  });
  it('out-of-range player rejected', () => {
    const m = mkMob(10, 10, 3, { range: 4 });
    // Player at chebyshev > range from mob's footprint
    expect(mobHasLOS(openRegion, m, mkPlayer(25, 10))).toBe(false);
  });
  it('range==1 NPC falls back to melee range', () => {
    const m = mkMob(10, 10, 1, { range: 1 });
    expect(hasLineOfSight(openRegion, m.x, m.y, 11, 10, 1, 1, true)).toBe(true);
    expect(hasLineOfSight(openRegion, m.x, m.y, 12, 10, 1, 1, true)).toBe(false);
  });
});

describe('pillar blocks LOS', () => {
  it('shots crossing a pillar footprint are blocked', () => {
    // Pillar S at (11,24) size 3 occupies x:11..13, y:22..24.
    const region = createRegion({ S: true, W: false, N: false });
    expect(raycast(region, 8, 23, 16, 23)).toBe(false);
    // Shot above the pillar passes
    expect(raycast(region, 8, 20, 16, 20)).toBe(true);
  });
});
