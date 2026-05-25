import type { MobDef, MobType } from '../types';

export const MOB_DEFS: Record<MobType, MobDef> = {
  mager: { letter: 'M', size: 4, hp: 220, atkSpeed: 4, range: 15, style: 'magic', color: '#4F86E8', hasFlicker: true },
  ranger: { letter: 'R', size: 3, hp: 125, atkSpeed: 4, range: 15, style: 'range', color: '#43A85B' },
  meleer: { letter: 'X', size: 4, hp: 75, atkSpeed: 4, range: 1, style: 'melee', color: '#3E434B', hasDig: true },
  blob: { letter: 'B', size: 3, hp: 40, atkSpeed: 3, range: 15, style: 'blob', color: '#D9C24A', isBlob: true },
  bat: { letter: 'Y', size: 2, hp: 25, atkSpeed: 3, range: 4, style: 'range', color: '#B3FAB6' },
  nibbler: { letter: 'N', size: 1, hp: 10, atkSpeed: 4, range: 1, style: 'melee', color: '#aaaaaa' },
  blobletMage: { letter: 'a', size: 1, hp: 15, atkSpeed: 4, range: 15, style: 'magic', color: '#ff8844' },
  blobletRange: { letter: 'b', size: 1, hp: 15, atkSpeed: 4, range: 15, style: 'range', color: '#ffaa66' },
  blobletMelee: { letter: 'c', size: 1, hp: 15, atkSpeed: 4, range: 1, style: 'melee', color: '#cc6622' },
};

export const MOB_TYPE_PRIORITY: Record<MobType, number> = {
  mager: 0,
  ranger: 1,
  meleer: 2,
  blob: 3,
  bat: 4,
  nibbler: 5,
  blobletMage: 6,
  blobletRange: 7,
  blobletMelee: 8,
};

// Monster projectile hit-tick tables. Entry 0 is distance 1 from the projectile origin
// and the value is the hitsplat tick if the attack was initiated on tick 1.
export const MONSTER_PROJECTILE_HIT_TICKS: Record<
  'bat' | 'blobRange' | 'blobMage' | 'ranger' | 'mager',
  readonly number[]
> = {
  bat: [2, 2, 2, 3, 3],
  blobRange: [2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 5, 5, 5, 5, 6, 6],
  blobMage: [2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 6],
  ranger: [3, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 6, 6, 6, 6],
  mager: [2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 6],
};
