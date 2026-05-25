import { beforeEach, describe, expect, it } from 'vitest';
import { parseSpawnCode } from '../core/spawnCode';
import { LOADOUTS } from '../data/loadouts';
import type { PillarConfig, SimResult } from '../types';
import { optimizePrayerOrig } from './_origPrayerOptimizer';
import { runHeadlessSim } from './headless';
import { optimizePrayer } from './prayerOptimizer';

// Deterministic Mulberry32 PRNG matched to calcSimDamage.test.ts so generated SimResults
// are bit-identical across runs.
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

const PILLARS: PillarConfig = { S: true, W: true, N: true };

function gatherSimResults(
  spawn: string,
  tile: { x: number; y: number },
  loadout: keyof typeof LOADOUTS,
  n: number,
  seedBase: number
): SimResult[] {
  resetSeed(seedBase);
  const out: SimResult[] = [];
  for (let i = 0; i < n; i++) {
    const r = runHeadlessSim(spawn, tile, PILLARS, LOADOUTS[loadout], 300);
    if (r) out.push(r);
  }
  return out;
}

describe('optimizePrayer', () => {
  beforeEach(() => resetSeed());

  it('matches optimizePrayerOrig across loadouts × spawns × tiles', () => {
    const cases: Array<{ loadout: keyof typeof LOADOUTS; spawn: string; tile: { x: number; y: number } }> = [
      { loadout: 'magetank', spawn: 'MRXBYBYO', tile: { x: 10, y: 10 } },
      { loadout: 'magetank', spawn: 'MR9X8B7Y6X5', tile: { x: 14, y: 14 } },
      { loadout: 'magetank', spawn: 'MMRRBB', tile: { x: 12, y: 12 } },
      { loadout: 'blowpipe', spawn: 'XXXMR', tile: { x: 5, y: 25 } },
      { loadout: 'blowpipe', spawn: 'MRXBYBYO', tile: { x: 10, y: 10 } },
      { loadout: 'bloodBarrage', spawn: 'MRXBYBYO', tile: { x: 10, y: 10 } },
      { loadout: 'bloodBarrage', spawn: 'MMRRBB', tile: { x: 12, y: 12 } },
    ];

    for (const { loadout: lkey, spawn, tile } of cases) {
      const sims = gatherSimResults(spawn, tile, lkey, 10, 0xc0ffee ^ lkey.length ^ spawn.length);
      if (sims.length === 0) continue;
      const next = optimizePrayer(sims, spawn, PILLARS, LOADOUTS[lkey]);
      const orig = optimizePrayerOrig(sims, spawn, PILLARS, LOADOUTS[lkey]);
      expect(next, `loadout=${lkey} spawn=${spawn} tile=${tile.x},${tile.y}`).toEqual(orig);
    }
  });

  it('honors the optional parsedSpawn parameter without changing output', () => {
    const lkey = 'bloodBarrage' as const;
    const spawn = 'MRXBYBYO';
    const sims = gatherSimResults(spawn, { x: 10, y: 10 }, lkey, 8, 0xfeedf00d);
    const parsed = parseSpawnCode(spawn);
    const withoutParsed = optimizePrayer(sims, spawn, PILLARS, LOADOUTS[lkey]);
    const withParsed = optimizePrayer(sims, spawn, PILLARS, LOADOUTS[lkey], parsed as never);
    expect(withParsed).toEqual(withoutParsed);
  });

  it('handles empty simResults without crashing', () => {
    // Defensive smoke test: no sims => the function must still return a valid PrayerSolution
    // shape so callers (UI) do not blow up on bad spawn codes.
    const result = optimizePrayer([], 'MRXBYBYO', PILLARS, LOADOUTS.magetank);
    expect(result.sequence).toHaveLength(4);
    expect(typeof result.avgDamage).toBe('number');
  });
});
