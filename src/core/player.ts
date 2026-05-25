import type { Loadout, Mob, Player } from '../types';

export function createPlayer(x: number, y: number, loadout: Loadout): Player {
  return {
    x,
    y,
    size: 1,
    hp: 99,
    maxHp: 99,
    aggro: null,
    attackDelay: 0,
    range: loadout.range,
    atkSpeed: loadout.atkSpeed,
    incomingProjectiles: [],
    autoRetaliate: true,
    lastHit: true,
    recoilQueue: [],
    echoBootsCooldown: 0,
    lastBarrageTarget: null,
    lastAttacker: null,
  };
}

export function canSetLastAttacker(player: Player, mob: Mob): boolean {
  const a = player.aggro;
  return !a || a.dead || a === mob;
}

export function setPlayerLastAttacker(player: Player, mob: Mob): void {
  // While the player is already engaged, other NPCs do not steal last_attacker.
  if (canSetLastAttacker(player, mob)) player.lastAttacker = mob;
}
