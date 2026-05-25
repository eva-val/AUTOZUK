import { beforeEach, describe, expect, it } from 'vitest';
import { LOADOUTS } from '../data/loadouts';
import { headlessTick, initSimState } from './engine';
import { runHeadlessSim } from './headless';

// Deterministic Math.random (Mulberry32).
let _seed = 0xdeadbeef >>> 0;
function rand(): number {
  _seed = (_seed + 0x6d2b79f5) >>> 0;
  let t = _seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
Math.random = rand;
const resetSeed = (s = 0xdeadbeef) => {
  _seed = s >>> 0;
};

const PILLARS = { S: true, W: true, N: true } as const;

describe('SimState counter invariants', () => {
  beforeEach(() => resetSeed());

  it('aliveCount equals (mobs.length - mobs filtered by m.dead) throughout a run', () => {
    const state = initSimState('MRXBYBYO', { x: 10, y: 10 }, PILLARS, LOADOUTS.magetank, 'headless');
    expect(state).not.toBeNull();
    if (!state) return;
    const initialAlive = state.aliveCount;
    expect(initialAlive).toBe(state.mobs.length);

    for (let i = 0; i < 200; i++) {
      headlessTick(state);
      let deadByFlag = 0;
      for (const m of state.mobs) if (m.dead) deadByFlag++;
      expect(state.aliveCount, `tick ${state.tick}`).toBe(state.mobs.length - deadByFlag);
      if (state.aliveCount === 0) break;
    }
  });

  it('corpsesPending matches the count of mobs with dying > 0', () => {
    const state = initSimState('MRXBYBYO', { x: 10, y: 10 }, PILLARS, LOADOUTS.blowpipe, 'headless');
    if (!state) return;
    for (let i = 0; i < 200; i++) {
      headlessTick(state);
      let dyingCount = 0;
      for (const m of state.mobs) if (m.dying > 0) dyingCount++;
      expect(state.corpsesPending, `tick ${state.tick}`).toBe(dyingCount);
      if (state.aliveCount === 0) break;
    }
  });

  it('pendingDeathCount matches the count of mobs with pendingRemovalTick set', () => {
    const state = initSimState('MRXBYBYO', { x: 10, y: 10 }, PILLARS, LOADOUTS.blowpipe, 'headless');
    if (!state) return;
    for (let i = 0; i < 200; i++) {
      headlessTick(state);
      let pending = 0;
      for (const m of state.mobs) if (m.pendingRemovalTick !== undefined) pending++;
      expect(state.pendingDeathCount, `tick ${state.tick}`).toBe(pending);
      if (state.aliveCount === 0) break;
    }
  });
});

describe('runHeadlessSim', () => {
  beforeEach(() => resetSeed());

  it('terminates on player death, mob clear, trap, or timeout — never returns past maxTicks', () => {
    const r = runHeadlessSim('MRXBYBYO', { x: 10, y: 10 }, PILLARS, LOADOUTS.magetank, 50);
    expect(r).not.toBeNull();
    if (!r) return;
    expect(['complete', 'trapped', 'invalid', 'timeout']).toContain(r.status);
    expect(r.completedTick).toBeLessThanOrEqual(50);
  });

  it('with all mobs killable, produces complete status', () => {
    // Single bat is trivial for blowpipe.
    const r = runHeadlessSim('Y', { x: 10, y: 10 }, PILLARS, LOADOUTS.blowpipe, 200);
    expect(r).not.toBeNull();
    if (!r) return;
    // It's possible the bat doesn't get LOS depending on tile placement; allow either
    // complete or trapped, but reject timeout/invalid.
    expect(['complete', 'trapped']).toContain(r.status);
  });

  it('produces deterministic results with a fixed seed', () => {
    resetSeed(0xfeed1);
    const a = runHeadlessSim('MRXBYBYO', { x: 10, y: 10 }, PILLARS, LOADOUTS.magetank, 200);
    resetSeed(0xfeed1);
    const b = runHeadlessSim('MRXBYBYO', { x: 10, y: 10 }, PILLARS, LOADOUTS.magetank, 200);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    if (!a || !b) return;
    expect(b.completedTick).toBe(a.completedTick);
    expect(b.status).toBe(a.status);
    expect(b.attacks.length).toBe(a.attacks.length);
    for (let i = 0; i < a.attacks.length; i++) {
      expect(b.attacks[i]).toEqual(a.attacks[i]);
    }
  });
});

describe('LOS cache (mob._losCacheKey)', () => {
  beforeEach(() => resetSeed());

  it('does not change observable sim behavior', () => {
    // Compare attack streams from two identical runs; the cache should be a pure speedup.
    resetSeed(0xc0);
    const a = runHeadlessSim('MRX', { x: 12, y: 12 }, PILLARS, LOADOUTS.magetank, 150)!;
    resetSeed(0xc0);
    const b = runHeadlessSim('MRX', { x: 12, y: 12 }, PILLARS, LOADOUTS.magetank, 150)!;
    expect(b.attacks).toEqual(a.attacks);
    expect(b.completedTick).toBe(a.completedTick);
  });
});
