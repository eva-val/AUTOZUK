import { collisionMath } from '../core/geometry';
import { hasLineOfSight, isWithinMeleeRange } from '../core/los';
import type { Mob, Region } from '../types';

// A "tile" can be excluded for several reasons: a pillar/mob footprint sits on it,
// or a high-priority combination of three big mobs (mager/ranger/meleer) can all hit it
// from spawn. Trapping setups need to avoid being in the same kill zone as multiple big NPCs.
export function checkTileExcluded(
  x: number,
  y: number,
  mobs: Array<Pick<Mob, 'x' | 'y' | 'size' | 'type' | 'range'>>,
  region: Region
): boolean {
  // Physical blockers: pillar tiles cannot be selected.
  for (const p of region.pillars) {
    if (collisionMath(p.x, p.y, p.size, x, y, 1)) return true;
  }
  // Directly under an enemy footprint only. Adjacent/melee-range tiles are allowed.
  for (const m of mobs) {
    if (collisionMath(m.x, m.y, m.size, x, y, 1)) return true;
  }
  // Initial spawn attack-range overlap exclusions only: mager+ranger, ranger+meleer, or mager+meleer.
  const fakeTarget: Mob = {
    id: -1,
    type: 'nibbler',
    letter: 'P',
    x,
    y,
    size: 1,
    hp: 1,
    maxHp: 1,
    atkSpeed: 1,
    range: 1,
    style: 'melee',
    color: '#fff',
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
  };
  const types = { mager: false, ranger: false, meleer: false };
  for (const m of mobs) {
    if (m.type === 'mager' || m.type === 'ranger' || m.type === 'meleer') {
      const has =
        m.range === 1
          ? isWithinMeleeRange({ x: m.x, y: m.y, size: m.size } as Mob, fakeTarget)
          : hasLineOfSight(region, m.x, m.y, x, y, m.size, m.range, true);
      if (has) types[m.type] = true;
    }
  }
  if (types.mager && types.ranger) return true;
  if (types.ranger && types.meleer) return true;
  if (types.mager && types.meleer) return true;
  return false;
}

export function checkTrappedValid(trapped: Mob[]): boolean {
  if (trapped.length === 0) return true;
  if (trapped.length > 2) return false;
  if (trapped.some((m) => m.type === 'mager')) return false;
  if (trapped.length === 1) return true;
  // 2 trapped: allowed combos: 2 blobs, 2 bats, bat+ranger
  const types = trapped.map((m) => m.type).sort();
  const key = types.join('+');
  return key === 'blob+blob' || key === 'bat+bat' || key === 'bat+ranger';
}
