import { resolveMonsterAttackStats } from '../core/projectiles';
import { isSpawnCodeError, parseSpawnCode } from '../core/spawnCode';
import type {
  AttackEvent,
  AttackStyle,
  DamageResult,
  Loadout,
  MobType,
  PillarConfig,
  PrayerSequence,
  PrayerSolution,
  PrayerType,
  SimResult,
} from '../types';

interface RecoilQueueItem {
  tick: number;
  mobId: number;
  damage: number;
}

interface PendingPlayerHit {
  tick: number;
  mobId: number;
  damage: number;
}

interface PendingMobRemoval {
  tick: number;
  mobId: number;
}

const isStyleBlocked = (style: AttackStyle | null, pray: PrayerType): boolean => {
  if (style === 'magic' && pray === 'mage') return true;
  if (style === 'range' && pray === 'range') return true;
  if (style === 'melee' && pray === 'melee') return true;
  return false;
};

export function calcSimDamage(
  attacks: AttackEvent[],
  prayerSeq: PrayerSequence,
  loadout: Loadout,
  mobInitHP: Record<number, { hp: number; type: MobType }>
): DamageResult {
  let hp = 99;
  const maxHp = 99;
  let minHp = 99;
  let died = false;
  const hasRecoil = loadout.hasRecoil === true && mobInitHP !== undefined;
  const mobHP: Record<number, number> = {};
  const deadMobs = new Set<number>();
  let echoBootsCooldown = 0;
  let pendingRecoil: RecoilQueueItem[] = [];
  let pendingPlayerHits: PendingPlayerHit[] = [];
  let pendingMobRemovals: PendingMobRemoval[] = [];
  if (hasRecoil) {
    for (const id in mobInitHP) mobHP[+id] = mobInitHP[+id]!.hp;
  }
  function applyPendingDeaths(currentTick: number): void {
    if (!hasRecoil) return;
    for (let i = pendingMobRemovals.length - 1; i >= 0; i--) {
      const r = pendingMobRemovals[i]!;
      if (r.tick <= currentTick) {
        deadMobs.add(r.mobId);
        pendingMobRemovals.splice(i, 1);
      }
    }
  }
  function scheduleMobRemoval(mobId: number, hitTick: number): void {
    if (!hasRecoil) return;
    if (deadMobs.has(mobId)) return;
    const removeTick = hitTick + 1;
    const existing = pendingMobRemovals.find((r) => r.mobId === mobId);
    if (existing) existing.tick = Math.min(existing.tick, removeTick);
    else pendingMobRemovals.push({ tick: removeTick, mobId });
  }
  function applyPendingPlayerHits(currentTick: number): void {
    if (!hasRecoil || pendingPlayerHits.length === 0) return;
    for (let i = pendingPlayerHits.length - 1; i >= 0; i--) {
      const h = pendingPlayerHits[i]!;
      if (h.tick <= currentTick) {
        if (!deadMobs.has(h.mobId) && mobHP[h.mobId] !== undefined && mobHP[h.mobId]! > 0) {
          mobHP[h.mobId]! -= h.damage;
          if (mobHP[h.mobId]! <= 0) scheduleMobRemoval(h.mobId, h.tick);
        }
        pendingPlayerHits.splice(i, 1);
      }
    }
  }

  for (const atk of attacks) {
    applyPendingPlayerHits(atk.tick);
    applyPendingDeaths(atk.tick);
    if (hasRecoil && pendingRecoil.length > 0) {
      for (let i = pendingRecoil.length - 1; i >= 0; i--) {
        const r = pendingRecoil[i]!;
        if (r.tick <= atk.tick) {
          if (!deadMobs.has(r.mobId) && mobHP[r.mobId] !== undefined && mobHP[r.mobId]! > 0) {
            mobHP[r.mobId]! -= r.damage;
            if (mobHP[r.mobId]! <= 0) scheduleMobRemoval(r.mobId, r.tick);
          }
          pendingRecoil.splice(i, 1);
        }
      }
      applyPendingDeaths(atk.tick);
    }
    if (atk.isPlayerAttack) {
      if (loadout.isBloodBarrage && atk.playerDmg !== undefined && atk.playerDmg > 0 && hp < maxHp) {
        hp = Math.min(maxHp, hp + Math.floor(atk.playerDmg * 0.25));
      }
      if (hasRecoil && atk.targetMobId !== undefined && mobHP[atk.targetMobId] !== undefined) {
        pendingPlayerHits.push({
          tick: atk.hitTick ?? atk.tick,
          mobId: atk.targetMobId,
          damage: atk.playerDmg ?? 0,
        });
      }
      continue;
    }
    if (atk.isRevive) {
      if (hasRecoil) {
        deadMobs.delete(atk.mobId);
        mobHP[atk.mobId] =
          atk.reviveHp !== undefined
            ? atk.reviveHp
            : mobInitHP[atk.mobId]
              ? Math.floor(mobInitHP[atk.mobId]!.hp / 2)
              : 0;
        pendingMobRemovals = pendingMobRemovals.filter((r) => r.mobId !== atk.mobId);
        pendingPlayerHits = pendingPlayerHits.filter((h) => h.mobId !== atk.mobId);
        pendingRecoil = pendingRecoil.filter((r) => r.mobId !== atk.mobId);
      }
      continue;
    }
    if (atk.isScan) continue;
    if (hasRecoil && deadMobs.has(atk.mobId)) continue;
    const prayOnTick = prayerSeq[atk.tick % 4]!;
    let atkStyle: AttackStyle = atk.style ?? 'magic';
    if (atk.style === null) {
      const prayOnScan = prayerSeq[atk.scanTick % 4]!;
      atkStyle = prayOnScan === 'mage' ? 'range' : 'magic';
    }
    if (isStyleBlocked(atkStyle, prayOnTick)) continue;
    const atkStats = resolveMonsterAttackStats(loadout, atk.mobType, atkStyle);
    if (!atkStats) continue;
    if (atk.accRoll < atkStats.acc) {
      const dmg = Math.floor(atk.dmgRoll * (atkStats.max + 1));
      if (dmg > 0) {
        hp -= dmg;
        if (hp < minHp) minHp = hp;
        if (hasRecoil) {
          const recoilTick = (atk.hitTick !== undefined ? atk.hitTick : atk.tick + 1) + 1;
          const ringDmg = Math.floor(dmg * 0.1 + 1);
          pendingRecoil.push({ tick: recoilTick, mobId: atk.mobId, damage: ringDmg });
          const dist = atk.distAtFire ?? 99;
          if (dist <= 1 && recoilTick >= echoBootsCooldown) {
            pendingRecoil.push({ tick: recoilTick, mobId: atk.mobId, damage: 1 });
            echoBootsCooldown = recoilTick + 4;
          }
        }
      }
      if (hp <= 0) {
        died = true;
        break;
      }
    }
  }
  if (hasRecoil) {
    applyPendingPlayerHits(Infinity);
    for (const r of pendingRecoil) {
      if (!deadMobs.has(r.mobId) && mobHP[r.mobId] !== undefined && mobHP[r.mobId]! > 0) {
        mobHP[r.mobId]! -= r.damage;
        if (mobHP[r.mobId]! <= 0) scheduleMobRemoval(r.mobId, r.tick);
      }
    }
  }
  return {
    damage: died ? 99 : loadout.isBloodBarrage ? Math.max(0, 99 - minHp) : Math.max(0, 99 - hp),
    died,
  };
}

export function optimizePrayer(
  allSimResults: SimResult[],
  spawnCode: string,
  _pillarConfig: PillarConfig,
  loadout: Loadout
): PrayerSolution {
  const parsed = parseSpawnCode(spawnCode);
  const mobTypes = new Set<MobType>();
  if (!isSpawnCodeError(parsed)) {
    for (const s of parsed.spawns) if (s.type !== 'nothing') mobTypes.add(s.type);
  }
  const hasMager = mobTypes.has('mager');
  const hasRanger = mobTypes.has('ranger');
  const hasMeleer = mobTypes.has('meleer');

  const slots: (PrayerType | null)[] = [null, null, null, null];
  type Votes = Record<number, number> & { found?: boolean };
  const slotVotes: Record<'mager' | 'ranger' | 'meleer', Votes> = {
    mager: {},
    ranger: {},
    meleer: {},
  };
  for (const result of allSimResults) {
    for (const atk of result.attacks) {
      if (atk.isScan) continue;
      if (atk.mobType === 'mager' && hasMager && !slotVotes.mager.found) {
        slotVotes.mager[atk.tick % 4] = (slotVotes.mager[atk.tick % 4] ?? 0) + 1;
        slotVotes.mager.found = true;
      }
      if (atk.mobType === 'ranger' && hasRanger && !slotVotes.ranger.found) {
        slotVotes.ranger[atk.tick % 4] = (slotVotes.ranger[atk.tick % 4] ?? 0) + 1;
        slotVotes.ranger.found = true;
      }
      if (atk.mobType === 'meleer' && hasMeleer && !slotVotes.meleer.found) {
        slotVotes.meleer[atk.tick % 4] = (slotVotes.meleer[atk.tick % 4] ?? 0) + 1;
        slotVotes.meleer.found = true;
      }
    }
    delete slotVotes.mager.found;
    delete slotVotes.ranger.found;
    delete slotVotes.meleer.found;
  }
  function getBestSlot(votes: Votes): number {
    let best = -1;
    let bestCount = 0;
    for (let s = 0; s < 4; s++) {
      const c = votes[s] ?? 0;
      if (c > bestCount) {
        bestCount = c;
        best = s;
      }
    }
    return best;
  }
  if (hasMager) {
    const s = getBestSlot(slotVotes.mager);
    if (s >= 0) slots[s] = 'mage';
  }
  if (hasRanger) {
    const s = getBestSlot(slotVotes.ranger);
    if (s >= 0 && !slots[s]) slots[s] = 'range';
  }
  if (hasMeleer) {
    const s = getBestSlot(slotVotes.meleer);
    if (s >= 0 && !slots[s]) slots[s] = 'melee';
  }

  const unknowns: number[] = [];
  for (let i = 0; i < 4; i++) if (!slots[i]) unknowns.push(i);

  let bestSeq: PrayerSequence | null = null;
  let bestDmg = Infinity;
  const combos = 1 << unknowns.length;
  for (let c = 0; c < combos; c++) {
    const seq: (PrayerType | null)[] = [...slots];
    for (let i = 0; i < unknowns.length; i++) {
      seq[unknowns[i]!] = (c >> i) & 1 ? 'range' : 'mage';
    }
    const finalSeq = seq.map((s) => s ?? 'mage') as PrayerType[];
    let totalDmg = 0;
    for (const result of allSimResults) {
      totalDmg += calcSimDamage(result.attacks, finalSeq as PrayerSequence, loadout, result.mobInitHP).damage;
    }
    const avgDmg = totalDmg / allSimResults.length;
    if (avgDmg < bestDmg) {
      bestDmg = avgDmg;
      bestSeq = finalSeq as PrayerSequence;
    }
  }
  return { sequence: bestSeq ?? (['mage', 'range', 'mage', 'range'] as PrayerSequence), avgDamage: bestDmg };
}
