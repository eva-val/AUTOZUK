// Throwaway perf driver. Run with: npx tsx src/sim/__fixtures__/bench.ts
// Compares median wall-clock for a representative AUTOZUK-style workload.
import { LOADOUTS } from '../../data/loadouts';
import { createRegion } from '../../core/region';
import type { PillarConfig } from '../../types';
import { calcSimDamage, optimizePrayer } from '../prayerOptimizer';
import { runHeadlessSim } from '../headless';

// Mulberry32 RNG to take Math.random's quirks off the table.
let _seed = 0xdeadbeef >>> 0;
function rand(): number {
  _seed = (_seed + 0x6d2b79f5) >>> 0;
  let t = _seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
Math.random = rand;

const PILLARS: PillarConfig = { S: true, W: true, N: true };
const SPAWN = 'MRXBYBYO';
const TILE = { x: 10, y: 10 };
const MAX_TICKS = 200;
const SIMS_PER_RUN = 200;
const RUNS = 100;

function once(loadoutKey: keyof typeof LOADOUTS): number {
  _seed = 0xdeadbeef >>> 0;
  const region = createRegion(PILLARS);
  const loadout = LOADOUTS[loadoutKey];
  const results = [];
  const t0 = performance.now();
  for (let i = 0; i < SIMS_PER_RUN; i++) {
    const r = runHeadlessSim(SPAWN, TILE, PILLARS, loadout, MAX_TICKS, region);
    if (r) results.push(r);
  }
  if (results.length > 0) {
    const pray = optimizePrayer(results, SPAWN, PILLARS, loadout);
    for (const r of results) calcSimDamage(r.attacks, pray.sequence, loadout, r.mobInitHP);
  }
  return performance.now() - t0;
}

function runLoadout(key: keyof typeof LOADOUTS): void {
  for (let i = 0; i < 2; i++) once(key);
  const times: number[] = [];
  for (let i = 0; i < RUNS; i++) times.push(once(key));
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)]!;
  const min = times[0]!;
  const max = times[times.length - 1]!;
  console.log(
    `[${key}] runs: ${RUNS}  min: ${min.toFixed(1)}ms  median: ${median.toFixed(1)}ms  max: ${max.toFixed(1)}ms  per-sim: ${(median / SIMS_PER_RUN).toFixed(2)}ms`
  );
}

runLoadout('magetank');
runLoadout('blowpipe');
runLoadout('bloodBarrage');
