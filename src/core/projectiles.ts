import { MONSTER_PROJECTILE_HIT_TICKS } from '../data/mobs';
import type { AttackStyle, Loadout, Mob, MobType, MonsterAttackBase, Player, Tile } from '../types';
import { chebyshev, distToMob } from './geometry';

export function rangedDelay(dist: number): number {
  if (dist <= 4) return 2;
  if (dist <= 8) return 3;
  if (dist <= 11) return 4;
  return 5;
}

export function magicDelay(dist: number): number {
  if (dist <= 6) return 2;
  if (dist <= 10) return 3;
  if (dist <= 14) return 4;
  return 5;
}

export function magerDelay(dist: number): number {
  if (dist <= 5) return 2;
  if (dist <= 9) return 3;
  if (dist <= 13) return 4;
  return 5;
}

export function delayFromHitTickList(list: readonly number[], dist: number): number {
  const d = Math.max(1, Math.floor(dist));
  const hitTick = list[Math.min(d, list.length) - 1]!;
  return hitTick - 1;
}

export function monsterProjectileOrigin(mob: Mob): Tile {
  // mob.x/mob.y is the SW tile of the NPC footprint.
  if (mob.type === 'mager') return { x: mob.x + 2, y: mob.y - 2 }; // NE tile of the central 2x2
  if (mob.type === 'bat') return { x: mob.x, y: mob.y }; // SW tile of the 2x2
  if (mob.type === 'ranger' || mob.type === 'blob') return { x: mob.x + 1, y: mob.y - 1 }; // center tile of 3x3
  return { x: mob.x, y: mob.y };
}

// Allocation-free variant — computes the chebyshev distance directly without building
// a Tile object. Hot path: called once per fired mob attack.
export function monsterProjectileDistance(px: number, py: number, mob: Mob): number {
  let ox: number;
  let oy: number;
  const t = mob.type;
  if (t === 'mager') {
    ox = mob.x + 2;
    oy = mob.y - 2;
  } else if (t === 'ranger' || t === 'blob') {
    ox = mob.x + 1;
    oy = mob.y - 1;
  } else {
    ox = mob.x;
    oy = mob.y;
  }
  const dx = px > ox ? px - ox : ox - px;
  const dy = py > oy ? py - oy : oy - py;
  return dx > dy ? dx : dy;
}

export function monsterProjectileDelay(mob: Mob, style: AttackStyle, player: Player): number {
  if (style === 'melee') return 1;
  const originDist = monsterProjectileDistance(player.x, player.y, mob);
  if (mob.type === 'mager') return delayFromHitTickList(MONSTER_PROJECTILE_HIT_TICKS.mager, originDist);
  if (mob.type === 'ranger') return delayFromHitTickList(MONSTER_PROJECTILE_HIT_TICKS.ranger, originDist);
  if (mob.type === 'bat') return delayFromHitTickList(MONSTER_PROJECTILE_HIT_TICKS.bat, originDist);
  if (mob.type === 'blob')
    return delayFromHitTickList(
      style === 'range' ? MONSTER_PROJECTILE_HIT_TICKS.blobRange : MONSTER_PROJECTILE_HIT_TICKS.blobMage,
      originDist
    );
  // Preserve legacy timing for mobs not covered by the calibrated projectile-origin tables.
  const edgeDist = distToMob(player.x, player.y, mob);
  if (mob.type === 'blobletRange') return magicDelay(edgeDist);
  if (style === 'range') return rangedDelay(edgeDist);
  return magicDelay(edgeDist);
}

// Player projectile delays (weapon → hitsplat landing)
export function playerBlowpipeDelay(): number {
  return 2;
}

export function playerAyakDelay(dist: number): number {
  if (dist <= 2) return 2;
  return 3;
}

export function playerBarrageDelay(dist: number): number {
  if (dist <= 1) return 2;
  if (dist <= 3) return 3;
  if (dist <= 7) return 4;
  return 5;
}

// Blood barrage calculates distance to mob's SW tile directly
export function playerProjectileDelay(loadout: Loadout, px: number, py: number, target: Mob): number {
  if (loadout.atkSpeed === 2) return playerBlowpipeDelay(); // blowpipe
  if (loadout.isBloodBarrage) {
    const swDist = chebyshev(px, py, target.x, target.y);
    return playerBarrageDelay(swDist);
  }
  const dist = distToMob(px, py, target);
  return playerAyakDelay(dist); // mage tank
}

export function resolveMonsterAttackStats(
  loadout: Loadout,
  mobType: MobType,
  style: AttackStyle
): MonsterAttackBase | null {
  const monAtk = loadout.monsterAtk[mobType];
  if (!monAtk) return null;
  if (mobType === 'blob') {
    const blobStats = monAtk as { mage: MonsterAttackBase; range: MonsterAttackBase; melee: MonsterAttackBase };
    if (style === 'melee') return blobStats.melee;
    if (style === 'magic') return blobStats.mage;
    if (style === 'range') return blobStats.range;
    return blobStats.range;
  }
  const flatStats = monAtk as MonsterAttackBase & { melee?: MonsterAttackBase };
  if (style === 'melee' && flatStats.melee) return flatStats.melee;
  return flatStats;
}
