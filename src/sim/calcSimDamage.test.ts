import { beforeEach, describe, expect, it } from 'vitest';
import { LOADOUTS } from '../data/loadouts';
import type { PrayerSequence } from '../types';
import { calcSimDamageOrig } from './_origCalcSimDamage';
import { runHeadlessSim } from './headless';
import { applyPrayer, calcSimDamage, prepareSimDamage } from './prayerOptimizer';

// Deterministic Mulberry32 PRNG so repeated runs are bit-identical. We monkey-patch
// Math.random at module scope (vitest runs sequentially per file by default), but reset
// the seed before every test so order does not matter.
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

const PILLARS = { S: true, W: true, N: true } as const;
const PRAYER_SEQS: PrayerSequence[] = [
  ['mage', 'range', 'mage', 'range'],
  ['range', 'mage', 'range', 'mage'],
  ['mage', 'mage', 'range', 'range'],
  ['melee', 'mage', 'range', 'mage'],
  ['mage', 'melee', 'range', 'mage'],
];

describe('calcSimDamage', () => {
  beforeEach(() => resetSeed());

  it('matches the pre-refactor implementation across loadouts × spawns × prayers', () => {
    const cases: Array<{ loadout: keyof typeof LOADOUTS; spawn: string; tile: { x: number; y: number } }> = [
      { loadout: 'magetank', spawn: 'MRXBYBYO', tile: { x: 10, y: 10 } },
      { loadout: 'magetank', spawn: 'MR9X8B7Y6X5', tile: { x: 14, y: 14 } },
      { loadout: 'magetank', spawn: 'MBBYYR', tile: { x: 20, y: 15 } },
      { loadout: 'blowpipe', spawn: 'XXXMR', tile: { x: 5, y: 25 } },
      { loadout: 'blowpipe', spawn: 'MMRRBB', tile: { x: 12, y: 12 } },
      { loadout: 'bloodBarrage', spawn: 'MRXBYBYO', tile: { x: 10, y: 10 } },
      { loadout: 'bloodBarrage', spawn: 'MR9X8B7Y6X5', tile: { x: 14, y: 14 } },
    ];

    let totalCases = 0;
    for (const { loadout: lkey, spawn, tile } of cases) {
      const loadout = LOADOUTS[lkey];
      resetSeed(0xc0ffee ^ lkey.length ^ spawn.length);
      for (let s = 0; s < 15; s++) {
        const result = runHeadlessSim(spawn, tile, PILLARS, loadout, 300);
        if (!result) continue;
        for (const prayer of PRAYER_SEQS) {
          const orig = calcSimDamageOrig(result.attacks, prayer, loadout, result.mobInitHP);
          const next = calcSimDamage(result.attacks, prayer, loadout, result.mobInitHP);
          expect(next, `loadout=${lkey} spawn=${spawn} sim=${s} prayer=${prayer.join(',')}`).toEqual(orig);
          totalCases++;
        }
      }
    }
    expect(totalCases).toBeGreaterThan(400);
  });

  it('prepareSimDamage + applyPrayer is equivalent to calcSimDamage (single-pass wrapper)', () => {
    const loadout = LOADOUTS.bloodBarrage;
    resetSeed(0xabc123);
    const result = runHeadlessSim('MRXBYBYO', { x: 10, y: 10 }, PILLARS, loadout, 300)!;
    const prepared = prepareSimDamage(result.attacks, loadout, result.mobInitHP);
    for (const prayer of PRAYER_SEQS) {
      const a = calcSimDamage(result.attacks, prayer, loadout, result.mobInitHP);
      const b = applyPrayer(prepared, prayer, loadout);
      expect(b).toEqual(a);
    }
  });

  it('handles a sim with no attacks (player runs the timer out)', () => {
    // Empty attacks list → no damage, no death.
    const loadout = LOADOUTS.magetank;
    const r = calcSimDamage([], ['mage', 'range', 'mage', 'range'], loadout, {});
    expect(r).toEqual({ damage: 0, died: false });
  });

  it('returns died=true and damage=99 when player HP drops below zero mid-sim', () => {
    // Hand-rolled: a magic mob attacks while we pray range — guaranteed hit, max damage.
    const loadout = LOADOUTS.magetank;
    const heavyHit = Array.from({ length: 4 }, (_, i) => ({
      tick: i * 4,
      mobId: 0,
      mobType: 'mager' as const,
      style: 'magic' as const,
      isScan: false,
      scanTick: -1,
      accRoll: 0, // < acc, always hits
      dmgRoll: 0.999, // close to max
    }));
    const r = calcSimDamage(heavyHit, ['range', 'range', 'range', 'range'], loadout, { 0: { hp: 220, type: 'mager' } });
    expect(r.died).toBe(true);
    expect(r.damage).toBe(99);
  });

  it('blocked-prayer attack deals zero damage regardless of rolls', () => {
    const loadout = LOADOUTS.magetank;
    const blocked = [
      {
        tick: 0,
        mobId: 0,
        mobType: 'mager' as const,
        style: 'magic' as const,
        isScan: false,
        scanTick: -1,
        accRoll: 0,
        dmgRoll: 0.999,
      },
    ];
    const r = calcSimDamage(blocked, ['mage', 'mage', 'mage', 'mage'], loadout, { 0: { hp: 220, type: 'mager' } });
    expect(r).toEqual({ damage: 0, died: false });
  });

  it('blob attack: style resolved from prayer at scan tick', () => {
    const loadout = LOADOUTS.magetank;
    // Scan at tick 0 (mage prayer → atkStyle becomes range). Hit lands at tick 3, where
    // we pray range — should block. Then a second blob attack at tick 4 with scan at
    // tick 4 where prayer is mage → atkStyle range → at tick 7 prayer is mage → does
    // not block → hit applies.
    const blob1Scan = {
      tick: 0,
      mobId: 0,
      mobType: 'blob' as const,
      style: null,
      isScan: true,
      scanTick: 0,
      accRoll: 0,
      dmgRoll: 0,
    };
    const blob1Fire = {
      tick: 3,
      mobId: 0,
      mobType: 'blob' as const,
      style: null,
      isScan: false,
      scanTick: 0, // prayer slot 0 = 'mage' → atkStyle = 'range'
      accRoll: 0, // hits
      dmgRoll: 0.999, // big damage
    };
    const prayer: PrayerSequence = ['mage', 'mage', 'mage', 'range'];
    // At tick 3, prayer slot is 3 = 'range' → blocks 'range' style → no damage.
    const r = calcSimDamage([blob1Scan, blob1Fire], prayer, loadout, { 0: { hp: 40, type: 'blob' } });
    expect(r.damage).toBe(0);

    // Same fire but at tick 0 (prayer slot 0 = 'mage' → does not block 'range') → damage.
    const blob1FireUnblocked = { ...blob1Fire, tick: 0 };
    const r2 = calcSimDamage([blob1Scan, blob1FireUnblocked], prayer, loadout, { 0: { hp: 40, type: 'blob' } });
    expect(r2.damage).toBeGreaterThan(0);
  });
});
