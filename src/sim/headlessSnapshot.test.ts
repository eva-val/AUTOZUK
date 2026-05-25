import { beforeEach, describe, expect, it } from 'vitest';
import { LOADOUTS } from '../data/loadouts';
import type { PillarConfig } from '../types';
import baselineJson from './__fixtures__/headless.baseline.json';
import { runHeadlessSim } from './headless';

// End-to-end golden-baseline regression: the baseline JSON was captured against the
// PRE-REFACTOR code (HEAD = d93c812 "clean it up") via a one-time git-worktree capture
// (see plan file we-did-a-full-goofy-lecun.md). Each test case re-runs runHeadlessSim
// with the identical seed + inputs and asserts the output is bit-identical. This catches
// any cross-file regression the per-function comparison tests miss (LOS cache, counter
// drift, raycast slope edge cases, etc.).

let _seed = 0xdeadbeef >>> 0;
function rand(): number {
  _seed = (_seed + 0x6d2b79f5) >>> 0;
  let t = _seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
Math.random = rand;
function resetSeed(s: number): void {
  _seed = s >>> 0;
}

interface BaselineCase {
  tag: string;
  pillars: PillarConfig;
  seed: number;
  loadout: keyof typeof LOADOUTS;
  spawn: string;
  tile: { x: number; y: number };
  maxTicks: number;
  result: {
    status: string;
    completedTick: number;
    attacks: unknown[];
    mobInitHP: Record<string, { hp: number; type: string }>;
  } | null;
}

const baseline = baselineJson as unknown as BaselineCase[];

describe('runHeadlessSim — golden baseline vs pre-refactor', () => {
  beforeEach(() => resetSeed(0xdeadbeef));

  for (const c of baseline) {
    it(c.tag, () => {
      resetSeed(c.seed);
      const r = runHeadlessSim(c.spawn, c.tile, c.pillars, LOADOUTS[c.loadout], c.maxTicks);
      if (c.result === null) {
        expect(r).toBeNull();
        return;
      }
      expect(r).not.toBeNull();
      if (!r) return;
      // Compare only the observable contract (status, timing, attack stream, initial HP
      // map). The full SimResult contains live Mob refs which carry mutable cache fields
      // — comparing those would be brittle and not the point of this regression test.
      expect(r.status).toBe(c.result.status);
      expect(r.completedTick).toBe(c.result.completedTick);
      expect(r.attacks).toEqual(c.result.attacks);
      expect(r.mobInitHP).toEqual(c.result.mobInitHP);
    });
  }
});
