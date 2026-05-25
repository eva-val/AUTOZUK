import { describe, expect, it } from 'vitest';
import { createRegion } from '../core/region';
import { MOB_DEFS } from '../data/mobs';
import type { Mob, MobType } from '../types';
import { checkTileExcluded, checkTrappedValid } from './exclusion';

const REGION = createRegion({ S: true, W: true, N: true });

type TestMob = Pick<Mob, 'x' | 'y' | 'size' | 'type' | 'range'>;
function tm(type: MobType, x: number, y: number): TestMob {
  const d = MOB_DEFS[type];
  return { type, x, y, size: d.size, range: d.range };
}

describe('checkTileExcluded', () => {
  it('excludes tiles inside a pillar footprint', () => {
    // Pillar S at (11,24), size 3 → x:11..13, y:22..24
    expect(checkTileExcluded(11, 24, [], REGION)).toBe(true);
    expect(checkTileExcluded(13, 22, [], REGION)).toBe(true);
    expect(checkTileExcluded(10, 24, [], REGION)).toBe(false);
  });

  it('excludes tiles inside an enemy footprint', () => {
    const m = tm('mager', 10, 12); // 4x4: x:10..13, y:9..12
    expect(checkTileExcluded(11, 11, [m], REGION)).toBe(true);
    expect(checkTileExcluded(14, 11, [m], REGION)).toBe(false);
  });

  it('excludes tiles where two of {mager, ranger, meleer} both have LOS', () => {
    // Place mager+ranger so both can see the same tile. Target (15,16) is reachable by
    // mager(2,6) and ranger(23,6) — note that pillar N at (18,8) blocks lines that pass
    // through its footprint, so the target must sit below/around pillar N for both rays.
    const mager = tm('mager', 2, 6);
    const ranger = tm('ranger', 23, 6);
    expect(checkTileExcluded(15, 16, [mager, ranger], REGION)).toBe(true);
  });

  it('does not exclude tiles where only one big mob has LOS', () => {
    // Only a mager — single-type LOS is allowed (no pair).
    const mager = tm('mager', 2, 6);
    expect(checkTileExcluded(15, 12, [mager], REGION)).toBe(false);
  });

  it('allows safe corners that no big mob can see', () => {
    const mager = tm('mager', 2, 6);
    const ranger = tm('ranger', 23, 6);
    // A tile behind the south pillar (11,24)/(13,22) blocked from both spawn points.
    expect(checkTileExcluded(12, 26, [mager, ranger], REGION)).toBe(false);
  });
});

describe('checkTrappedValid', () => {
  it('zero trapped → valid (vacuously)', () => {
    expect(checkTrappedValid([])).toBe(true);
  });
  it('mager trapped → never valid', () => {
    const mager = tm('mager', 2, 6) as Mob;
    expect(checkTrappedValid([mager as Mob])).toBe(false);
  });
  it('3+ trapped → invalid', () => {
    expect(checkTrappedValid([tm('blob', 0, 0) as Mob, tm('blob', 0, 0) as Mob, tm('blob', 0, 0) as Mob])).toBe(false);
  });
  it('valid 2-mob combos: blob+blob, bat+bat, bat+ranger', () => {
    expect(checkTrappedValid([tm('blob', 0, 0) as Mob, tm('blob', 0, 0) as Mob])).toBe(true);
    expect(checkTrappedValid([tm('bat', 0, 0) as Mob, tm('bat', 0, 0) as Mob])).toBe(true);
    expect(checkTrappedValid([tm('bat', 0, 0) as Mob, tm('ranger', 0, 0) as Mob])).toBe(true);
  });
  it('invalid 2-mob combos: ranger+blob, meleer+anything', () => {
    expect(checkTrappedValid([tm('ranger', 0, 0) as Mob, tm('blob', 0, 0) as Mob])).toBe(false);
    expect(checkTrappedValid([tm('meleer', 0, 0) as Mob, tm('blob', 0, 0) as Mob])).toBe(false);
  });
});
