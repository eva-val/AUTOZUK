import { describe, expect, it } from 'vitest';
import type { Entity, Mob } from '../types';
import {
  chebyshev,
  closestTileTo,
  closestTileToScratch,
  collidesWithEntities,
  collidesWithMobs,
  collisionMath,
  distToMob,
  SCRATCH_CX,
  SCRATCH_CY,
} from './geometry';

function mkMob(x: number, y: number, size: number, overrides: Partial<Mob> = {}): Mob {
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
    incomingProjectiles: [],
    noLOSTicks: 0,
    currentStyle: null,
    ...overrides,
  };
}

describe('chebyshev', () => {
  it('is zero for same point', () => {
    expect(chebyshev(5, 5, 5, 5)).toBe(0);
  });
  it('takes the max of |dx| and |dy|', () => {
    expect(chebyshev(0, 0, 3, 4)).toBe(4);
    expect(chebyshev(0, 0, -7, 2)).toBe(7);
    expect(chebyshev(10, 10, 8, 4)).toBe(6);
  });
});

describe('collisionMath', () => {
  it('detects overlap of 1x1 boxes', () => {
    expect(collisionMath(5, 5, 1, 5, 5, 1)).toBe(true);
  });
  it('rejects neighbors that do not overlap', () => {
    expect(collisionMath(5, 5, 1, 6, 5, 1)).toBe(false);
    expect(collisionMath(5, 5, 1, 5, 6, 1)).toBe(false);
    expect(collisionMath(5, 5, 1, 5, 4, 1)).toBe(false);
  });
  it('handles size>1 footprints (SW origin, mob occupies y..y-s+1)', () => {
    // A 3x3 at (5,7) occupies x in [5,7], y in [5,7].
    expect(collisionMath(5, 7, 3, 6, 6, 1)).toBe(true);
    expect(collisionMath(5, 7, 3, 7, 7, 1)).toBe(true);
    expect(collisionMath(5, 7, 3, 8, 7, 1)).toBe(false);
    expect(collisionMath(5, 7, 3, 5, 4, 1)).toBe(false);
  });
});

describe('closestTileTo', () => {
  it('returns the tile itself when the target is inside the footprint', () => {
    const m = mkMob(5, 7, 3); // 3x3 at x:5..7, y:5..7
    expect(closestTileTo(m, 6, 6)).toEqual({ x: 6, y: 6 });
  });
  it('clamps to the nearest edge tile', () => {
    const m = mkMob(5, 7, 3);
    expect(closestTileTo(m, 10, 6)).toEqual({ x: 7, y: 6 });
    expect(closestTileTo(m, 6, 100)).toEqual({ x: 6, y: 7 });
    expect(closestTileTo(m, 0, 0)).toEqual({ x: 5, y: 5 });
  });
});

describe('closestTileToScratch', () => {
  it('writes the same values to scratch globals as closestTileTo returns', () => {
    const m = mkMob(5, 7, 3);
    for (const [tx, ty] of [
      [10, 6],
      [6, 100],
      [0, 0],
      [6, 6],
    ] as const) {
      const expected = closestTileTo(m, tx, ty);
      closestTileToScratch(m, tx, ty);
      // Re-import via the module's getters because TS treats the named binding as the
      // exported value at the time of import; here we just check via a fresh dynamic read.
      const cx = SCRATCH_CX;
      const cy = SCRATCH_CY;
      expect({ x: cx, y: cy }).toEqual(expected);
    }
  });
});

describe('distToMob', () => {
  it('matches the chebyshev distance from the closest face tile', () => {
    const m = mkMob(5, 7, 3);
    expect(distToMob(10, 6, m)).toBe(3); // closest tile (7,6) → chebyshev(10,6) = 3
    expect(distToMob(6, 6, m)).toBe(0); // inside footprint
    expect(distToMob(8, 8, m)).toBe(1); // off SE corner of the 3x3
  });
});

describe('collidesWithEntities', () => {
  it('returns true when the box overlaps any entity', () => {
    const e: Entity[] = [
      { x: 0, y: 0, size: 1 },
      { x: 10, y: 10, size: 3 },
    ];
    expect(collidesWithEntities(10, 10, 1, e)).toBe(true);
    expect(collidesWithEntities(7, 8, 1, e)).toBe(false);
  });
});

describe('collidesWithMobs', () => {
  it('skips the excluded mob', () => {
    const a = mkMob(5, 5, 1);
    const b = mkMob(5, 5, 1, { id: 2 });
    expect(collidesWithMobs(5, 5, 1, [a, b], a)).toBe(b);
    expect(collidesWithMobs(5, 5, 1, [a, b], b)).toBe(a);
  });
  it('skips dead mobs', () => {
    const a = mkMob(5, 5, 1, { dead: true });
    expect(collidesWithMobs(5, 5, 1, [a], null)).toBe(null);
  });
  it('skipNibblers ignores nibbler-typed mobs', () => {
    const a = mkMob(5, 5, 1, { type: 'nibbler' });
    expect(collidesWithMobs(5, 5, 1, [a], null, true)).toBe(null);
    expect(collidesWithMobs(5, 5, 1, [a], null, false)).toBe(a);
  });
});
